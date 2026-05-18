import {
  computed,
  createApp,
  nextTick,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  watch,
} from "https://unpkg.com/vue@3/dist/vue.esm-browser.prod.js";
import { fetchReservations } from "./mockApi.js";

const PX_PER_MINUTE = 1.65;
const TABLE_COLUMN_WIDTH = 132;
const TIME_COLUMN_WIDTH = 72;
const STEP_MINUTES = 10;

const toMinutes = (value) => {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
};

const minutesFromIso = (value, timeZone) => {
  const parts = new Intl.DateTimeFormat("ru-RU", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(value));
  const hours = Number(parts.find((part) => part.type === "hour").value);
  const minutes = Number(parts.find((part) => part.type === "minute").value);
  return hours * 60 + minutes;
};

const formatMinutes = (value) => {
  const normalized = Math.max(0, value);
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
};

const makeRestaurantIso = (day, minute) => `${day}T${formatMinutes(minute)}:00.000000+10:00`;

const formatDateButton = (day, currentDay) => {
  const date = new Date(`${day}T00:00:00`);
  const weekday = new Intl.DateTimeFormat("ru-RU", { weekday: "long" }).format(date);
  const title = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" }).format(date);
  return {
    title,
    caption: day === currentDay ? "сегодня" : weekday,
  };
};

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const statusTone = (status) => {
  if (["New", "Новая", "Заявка"].includes(status)) return "tone-new";
  if (["Bill", "Открыт"].includes(status)) return "tone-active";
  if (["Closed", "Закрыт"].includes(status)) return "tone-closed";
  if (status === "Banquet") return "tone-banquet";
  if (status === "Живая очередь") return "tone-queue";
  return "tone-new";
};

const layoutEvents = (events) => {
  const sorted = [...events].sort((a, b) => a.start - b.start || b.end - a.end);
  const lanes = [];

  sorted.forEach((event) => {
    let laneIndex = lanes.findIndex((laneEnd) => laneEnd <= event.start);
    if (laneIndex === -1) {
      laneIndex = lanes.length;
      lanes.push(event.end);
    } else {
      lanes[laneIndex] = event.end;
    }

    event.lane = laneIndex;
    event.laneCount = lanes.length;
    sorted
      .filter((item) => item.start < event.end && item.end > event.start)
      .forEach((item) => {
        item.laneCount = Math.max(item.laneCount || 1, lanes.length);
      });
  });

  return sorted;
};

createApp({
  setup() {
    const payload = ref(null);
    const selectedDay = ref("2025-04-04");
    const activeZones = ref([]);
    const searchQuery = ref("");
    const loading = ref(true);
    const theme = ref(localStorage.getItem("airesto-theme") || "dark");
    const privateMode = ref(false);
    const restaurantNow = ref("");
    const restaurantMinute = ref(null);
    const viewport = ref(null);
    const selection = reactive({
      active: false,
      startTableIndex: null,
      endTableIndex: null,
      startMinute: null,
      endMinute: null,
    });

    const load = async (day) => {
      loading.value = true;
      payload.value = await fetchReservations(day);
      selectedDay.value = day;
      if (!activeZones.value.length) {
        activeZones.value = [...new Set(payload.value.tables.map((table) => table.zone))];
      }
      loading.value = false;
      await nextTick();
      viewport.value?.scrollTo({ left: 0, top: 0 });
    };

    const restaurant = computed(() => payload.value?.restaurant);
    const allZones = computed(() => [...new Set(payload.value?.tables.map((table) => table.zone) || [])]);
    const totalMinutes = computed(() => {
      if (!restaurant.value) return 0;
      return toMinutes(restaurant.value.closing_time) - toMinutes(restaurant.value.opening_time);
    });
    const openingMinute = computed(() => (restaurant.value ? toMinutes(restaurant.value.opening_time) : 0));
    const scheduleHeight = computed(() => totalMinutes.value * PX_PER_MINUTE);
    const gridTemplate = computed(() => `${TIME_COLUMN_WIDTH}px repeat(${visibleTables.value.length}, ${TABLE_COLUMN_WIDTH}px)`);
    const visibleTables = computed(() => (payload.value?.tables || []).filter((table) => activeZones.value.includes(table.zone)));

    const timeMarks = computed(() => {
      const marks = [];
      for (let minute = openingMinute.value; minute <= openingMinute.value + totalMinutes.value; minute += 30) {
        marks.push({
          time: formatMinutes(minute),
          top: (minute - openingMinute.value) * PX_PER_MINUTE,
        });
      }
      return marks;
    });

    const tablesWithEvents = computed(() =>
      visibleTables.value.map((table) => {
          const reservations = table.reservations
              .filter((reservation) =>
                  reservation.name_for_reservation
                      .toLowerCase()
                      .includes(searchQuery.value.toLowerCase())
              )
              .map((reservation) => ({
          id: `reservation-${reservation.id}`,
          sourceId: reservation.id,
          type: "reservation",
          status: reservation.status,
          title: reservation.status === "Живая очередь" ? "Очередь" : "Бронь",
          guest: reservation.name_for_reservation,
          phone: reservation.phone_number,
          people: reservation.num_people,
          start: minutesFromIso(reservation.seating_time, restaurant.value.timezone),
          end: minutesFromIso(reservation.end_time, restaurant.value.timezone),
          tone: statusTone(reservation.status),
        }));

          const orders = table.orders
              .filter((order) =>
                  order.guest
                      .toLowerCase()
                      .includes(searchQuery.value.toLowerCase())
              )
              .map((order) => ({
          id: order.id,
          sourceId: order.id,
          type: order.status === "Banquet" ? "banquet" : "order",
          status: order.status,
          title: order.status === "Banquet" ? "Банкет" : "Заказ",
          guest: order.guest,
          phone: order.phone,
          people: order.num_people,
          start: minutesFromIso(order.start_time, restaurant.value.timezone),
          end: minutesFromIso(order.end_time, restaurant.value.timezone),
          tone: statusTone(order.status),
        }));

        return {
          ...table,
          events: layoutEvents([...reservations, ...orders]).map((event) => ({
            ...event,
            top: (event.start - openingMinute.value) * PX_PER_MINUTE,
            height: Math.max((event.end - event.start) * PX_PER_MINUTE, 34),
          })),
        };
      }),
    );

    const selectedTables = computed(() => {
      if (!selection.active && selection.startTableIndex === null) return [];
      const minIndex = Math.min(selection.startTableIndex, selection.endTableIndex);
      const maxIndex = Math.max(selection.startTableIndex, selection.endTableIndex);
      return tablesWithEvents.value.slice(minIndex, maxIndex + 1);
    });

    const normalizedSelection = computed(() => {
      if (selection.startMinute === null || selection.endMinute === null) return null;
      const start = Math.min(selection.startMinute, selection.endMinute);
      const end = Math.max(selection.startMinute, selection.endMinute) + STEP_MINUTES;
      return {
        start,
        end,
        top: (start - openingMinute.value) * PX_PER_MINUTE,
        height: Math.max((end - start) * PX_PER_MINUTE, 20),
      };
    });

    const selectedTableIndexes = computed(() => new Set(selectedTables.value.map((table) => table.id)));

    const currentLineTop = computed(() => {
      if (!payload.value || selectedDay.value !== payload.value.current_day || restaurantMinute.value === null) return null;
      if (restaurantMinute.value < openingMinute.value || restaurantMinute.value > openingMinute.value + totalMinutes.value) return null;
      return (restaurantMinute.value - openingMinute.value) * PX_PER_MINUTE;
    });

    const isTableSelected = (tableId) => selectedTableIndexes.value.has(tableId);
    const mask = (value) => (privateMode.value ? "••••••" : value);

    const eventStyle = (event) => ({
      top: `${event.top}px`,
      height: `${event.height}px`,
      left: `calc(${event.lane * (100 / event.laneCount)}% + 3px)`,
      width: `calc(${100 / event.laneCount}% - 6px)`,
    });

    const selectionStyle = (table) => {
      if (!normalizedSelection.value || !isTableSelected(table.id)) return null;
      return {
        top: `${normalizedSelection.value.top}px`,
        height: `${normalizedSelection.value.height}px`,
      };
    };

    const updateRestaurantClock = () => {
      if (!restaurant.value) return;
      const now = new Date();
      const formatted = new Intl.DateTimeFormat("ru-RU", {
        timeZone: restaurant.value.timezone,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }).format(now);
      restaurantNow.value = formatted;
      const [hours, minutes] = formatted.split(":").map(Number);
      restaurantMinute.value = hours * 60 + minutes;
    };

    const toggleZone = (zone) => {
      activeZones.value = activeZones.value.includes(zone)
        ? activeZones.value.filter((item) => item !== zone)
        : [...activeZones.value, zone];
    };

    const setAllZones = (enabled) => {
      activeZones.value = enabled ? [...allZones.value] : [];
    };

    const pointerToSelection = (event) => {
      const target = event.currentTarget;
      const rect = target.getBoundingClientRect();
      const x = event.clientX - rect.left - TIME_COLUMN_WIDTH + target.scrollLeft;
      const y = event.clientY - rect.top - 56 + target.scrollTop;
      const tableIndex = clamp(Math.floor(x / TABLE_COLUMN_WIDTH), 0, tablesWithEvents.value.length - 1);
      const rawMinute = openingMinute.value + clamp(Math.floor(y / PX_PER_MINUTE), 0, totalMinutes.value);
      const roundedMinute = openingMinute.value + Math.floor((rawMinute - openingMinute.value) / STEP_MINUTES) * STEP_MINUTES;
      return { tableIndex, minute: roundedMinute };
    };

    const startSelection = (event) => {
      if (!tablesWithEvents.value.length || event.button !== 0) return;
      const picked = pointerToSelection(event);
      selection.active = true;
      selection.startTableIndex = picked.tableIndex;
      selection.endTableIndex = picked.tableIndex;
      selection.startMinute = picked.minute;
      selection.endMinute = picked.minute;
      event.currentTarget.setPointerCapture(event.pointerId);
    };

    const moveSelection = (event) => {
      if (!selection.active) return;
      const picked = pointerToSelection(event);
      selection.endTableIndex = picked.tableIndex;
      selection.endMinute = picked.minute;
    };

    const endSelection = () => {
      selection.active = false;
    };

    const createReservation = () => {
      if (!normalizedSelection.value || !selectedTables.value.length) return;
      const result = {
        tableIds: selectedTables.value.map((table) => table.id),
        startTime: formatMinutes(normalizedSelection.value.start),
        endTime: formatMinutes(normalizedSelection.value.end),
      };

      payload.value.tables
        .filter((table) => result.tableIds.includes(table.id))
        .forEach((table) => {
          table.reservations.push({
            id: Date.now() + table.reservations.length,
            name_for_reservation: "Новая бронь",
            num_people: Math.min(table.capacity, 4),
            phone_number: "+79990000000",
            status: "Новая",
            seating_time: makeRestaurantIso(selectedDay.value, normalizedSelection.value.start),
            end_time: makeRestaurantIso(selectedDay.value, normalizedSelection.value.end),
          });
        });

      console.log("Создать бронирование", JSON.stringify(result, null, 2));
    };

    watch(theme, (value) => {
      localStorage.setItem("airesto-theme", value);
      document.documentElement.dataset.theme = value;
    }, { immediate: true });

    watch(restaurant, () => {
      updateRestaurantClock();
    });

    let timerId;
    onMounted(() => {
      load(selectedDay.value);
      timerId = window.setInterval(updateRestaurantClock, 1000);
    });

    onBeforeUnmount(() => {
      window.clearInterval(timerId);
    });

    return {
      activeZones,
      allZones,
      createReservation,
      currentLineTop,
      eventStyle,
      formatDateButton,
      formatMinutes,
      gridTemplate,
      isTableSelected,
      load,
      loading,
      mask,
      moveSelection,
      normalizedSelection,
      payload,
      privateMode,
      restaurant,
      restaurantNow,
      selectedDay,
      selectedTables,
      selectionStyle,
      setAllZones,
      startSelection,
      endSelection,
      tablesWithEvents,
      theme,
      timeMarks,
      toggleZone,
      viewport,
      scheduleHeight,
      searchQuery,
    };
  },
  template: `
    <main class="app-shell" :class="{ loading }">
      <header class="topbar">
        <div>
          <span class="brand">AIRESTO</span>
          <span class="restaurant">| {{ restaurant?.restaurant_name || '...' }}</span>
        </div>
        <div class="toolbar">
          <div class="clock" title="Поиск по имени">
            <input   v-model="searchQuery"
                     type="text"
                     placeholder="Поиск по имени">
          </div>
          <button class="icon-button" @click="theme = theme === 'dark' ? 'light' : 'dark'" :title="theme === 'dark' ? 'Светлая тема' : 'Темная тема'">
            {{ theme === 'dark' ? '☀' : '●' }}
          </button>
          <button class="ghost-button" @click="privateMode = !privateMode">
            {{ privateMode ? 'Показать' : 'Скрыть' }}
          </button>
        </div>
      </header>

      <section class="controls">
        <div>
          <p class="eyebrow">Бронирования</p>
          <h1>Просмотр бронирований</h1>
        </div>

        <div class="control-group" v-if="payload">
          <span class="label">Дата</span>
          <div class="chips">
            <button
              v-for="day in payload.available_days"
              :key="day"
              class="chip"
              :class="{ active: selectedDay === day }"
              @click="load(day)"
            >
              <strong>{{ formatDateButton(day, payload.current_day).title }}</strong>
              <span>{{ formatDateButton(day, payload.current_day).caption }}</span>
            </button>
          </div>
        </div>

        <div class="control-group" v-if="payload">
          <span class="label">Отображаемые зоны</span>
          <div class="chips zone-row">
            <button class="mini-action" @click="setAllZones(true)">Все</button>
            <button class="mini-action" @click="setAllZones(false)">Снять</button>
            <button
              v-for="zone in allZones"
              :key="zone"
              class="chip zone"
              :class="{ active: activeZones.includes(zone) }"
              @click="toggleZone(zone)"
            >
              {{ zone }}
            </button>
          </div>
        </div>

        <button class="create-button" :disabled="!normalizedSelection" @click="createReservation">
          Создать
          <span v-if="normalizedSelection">
            {{ selectedTables.length }} стол. · {{ formatMinutes(normalizedSelection.start) }}–{{ formatMinutes(normalizedSelection.end) }}
          </span>
        </button>
      </section>

      <section
        class="schedule-viewport"
        ref="viewport"
        @pointerdown="startSelection"
        @pointermove="moveSelection"
        @pointerup="endSelection"
        @pointercancel="endSelection"
      >
        <div class="schedule-grid" :style="{ gridTemplateColumns: gridTemplate, minHeight: scheduleHeight + 56 + 'px' }">
          <div class="corner sticky-top sticky-left">Время</div>
          <div
            v-for="table in tablesWithEvents"
            :key="table.id"
            class="table-head sticky-top"
            :class="{ selected: isTableSelected(table.id) }"
          >
            <strong>№{{ table.number }}</strong>
            <span>{{ table.capacity }} чел</span>
            <small>{{ table.zone }}</small>
          </div>

          <div class="time-axis sticky-left" :style="{ height: scheduleHeight + 'px' }">
            <div v-for="mark in timeMarks" :key="mark.time" class="time-mark" :style="{ top: mark.top + 'px' }">
              {{ mark.time }}
            </div>
          </div>

          <div
            v-for="table in tablesWithEvents"
            :key="table.id + '-col'"
            class="table-column"
            :style="{ height: scheduleHeight + 'px' }"
          >
            <div v-if="selectionStyle(table)" class="selection-block" :style="selectionStyle(table)"></div>
            <article
              v-for="event in table.events"
              :key="event.id"
              class="event-card"
              :class="[event.type, event.tone]"
              :style="eventStyle(event)"
            >
              <div class="event-title">
                <strong>{{ event.title }}</strong>
                <span>{{ event.people }} чел</span>
              </div>
              <div class="event-guest">{{ mask(event.guest) }}</div>
              <div class="event-phone">{{ mask(event.phone) }}</div>
              <div class="event-time">{{ formatMinutes(event.start) }}–{{ formatMinutes(event.end) }}</div>
            </article>
          </div>

          <div v-if="currentLineTop !== null" class="now-line" :style="{ top: 56 + currentLineTop + 'px' }">
            <span>{{ restaurantNow.slice(0, 5) }}</span>
          </div>
        </div>

        <div v-if="!loading && !tablesWithEvents.length" class="empty-state">
          Выберите хотя бы одну зону
        </div>
      </section>
    </main>
  `,
}).mount("#app");
