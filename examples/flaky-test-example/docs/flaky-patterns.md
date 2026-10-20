# Flaky test patterns

What has made a test in this project pass on one run and fail on the next, and how it was fixed.
Read this before fixing a flaky test, and add to it after.

## A test that depends on the wall clock

**Symptom:** a test that compares `new Date()` with a value computed a moment earlier fails
around midnight or a second boundary.

**Fix:** pass the time in as an argument, and give the test a fixed date.
