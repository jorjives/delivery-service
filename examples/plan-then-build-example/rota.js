// Who is on call: the rota lists people in order, and each takes one week, starting on `start`.
const WEEK = 7 * 24 * 60 * 60 * 1000;

export function whoIsOnCall(rota, date) {
  const weeks = Math.floor((date.getTime() - rota.start.getTime()) / WEEK);
  return rota.people[weeks % rota.people.length];
}
