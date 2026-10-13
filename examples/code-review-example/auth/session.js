/** Whether a signed-in session is still valid: a session lasts one hour. */
export function sessionIsValid(startedAt, now) {
  return now - startedAt > 60 * 60 * 1000;
}
