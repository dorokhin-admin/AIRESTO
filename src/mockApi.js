const zones = ["1 этаж", "2 этаж", "Банкетный зал"];

const guestNames = [
  "Алина",
  "Валерия",
  "Максим",
  "Екатерина",
  "Александр",
  "Никита",
  "Мария",
  "Антон",
  "Полина",
  "Илья",
  "София",
  "Денис",
];

const reservationStatuses = ["Живая очередь", "Новая", "Заявка", "Открыт", "Закрыт"];
const orderStatuses = ["New", "Bill", "Closed", "Banquet"];

const dayLabels = ["2025-04-04", "2025-04-05", "2025-04-06", "2025-04-07", "2025-04-08"];

const pad = (value) => String(value).padStart(2, "0");

const makeIso = (date, minutes) => {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${date}T${pad(hours)}:${pad(mins)}:00.000000+10:00`;
};

const seeded = (seed) => {
  let value = seed % 2147483647;
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
};

const createEvent = (date, tableIndex, eventIndex, rand) => {
  const start = 11 * 60 + 20 + Math.floor(rand() * 590);
  const duration = 40 + Math.floor(rand() * 110);
  const end = Math.min(start + duration, 23 * 60 + 40);
  const people = 2 + Math.floor(rand() * 7);
  const isOrder = rand() > 0.54;
  const idSeed = `${date.replaceAll("-", "")}-${tableIndex}-${eventIndex}`;

  if (isOrder) {
    const status = orderStatuses[Math.floor(rand() * orderStatuses.length)];
    return {
      kind: "order",
      id: `order-${idSeed}`,
      status,
      start_time: makeIso(date, start),
      end_time: makeIso(date, end),
      num_people: people,
      guest: guestNames[Math.floor(rand() * guestNames.length)],
      phone: `+7999${pad(tableIndex)}${pad(eventIndex)}${pad(Math.floor(rand() * 99))}${pad(Math.floor(rand() * 99))}`,
    };
  }

  return {
    kind: "reservation",
    id: Number(`${tableIndex + 1}${eventIndex}${date.slice(-2)}`),
    name_for_reservation: guestNames[Math.floor(rand() * guestNames.length)],
    num_people: people,
    phone_number: `+7999${pad(tableIndex)}${pad(eventIndex)}${pad(Math.floor(rand() * 99))}${pad(Math.floor(rand() * 99))}`,
    status: reservationStatuses[Math.floor(rand() * reservationStatuses.length)],
    seating_time: makeIso(date, start),
    end_time: makeIso(date, end),
  };
};

const createTables = (date) => {
  const rand = seeded(Number(date.replaceAll("-", "")));
  const tables = [];

  for (let index = 0; index < 26; index += 1) {
    const zone = zones[index % zones.length];
    const eventCount = 2 + Math.floor(rand() * 7);
    const table = {
      id: `table-${index + 1}-${zone.replaceAll(" ", "-")}`,
      capacity: [2, 4, 6, 8][index % 4],
      number: String(index < 10 ? index + 5 : index + 15),
      zone,
      orders: [],
      reservations: [],
    };

    for (let eventIndex = 0; eventIndex < eventCount; eventIndex += 1) {
      const event = createEvent(date, index, eventIndex, rand);
      if (event.kind === "order") {
        table.orders.push({
          id: event.id,
          status: event.status,
          start_time: event.start_time,
          end_time: event.end_time,
          num_people: event.num_people,
          guest: event.guest,
          phone: event.phone,
        });
      } else {
        table.reservations.push({
          id: event.id,
          name_for_reservation: event.name_for_reservation,
          num_people: event.num_people,
          phone_number: event.phone_number,
          status: event.status,
          seating_time: event.seating_time,
          end_time: event.end_time,
        });
      }
    }

    tables.push(table);
  }

  return tables;
};

export const fetchReservations = async (day = "2025-04-04") => {
  await new Promise((resolve) => setTimeout(resolve, 180));

  return {
    available_days: dayLabels,
    current_day: "2025-04-04",
    restaurant: {
      id: 11100,
      timezone: "Asia/Vladivostok",
      restaurant_name: "Супра",
      opening_time: "11:00",
      closing_time: "23:40",
    },
    tables: createTables(day),
  };
};
