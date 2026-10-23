# Move off deprecated code

Find code that the project's own team has marked as replaced: a `@deprecated` note that names its replacement, or a legacy module whose successor is named beside it.
For each file that still uses that code, write one idea. Never write an idea for the deprecated code itself.
Route a test file's own calls to the tests workflow (`deprecations:tests`), and every other file to the code workflow (`deprecations:code`).
Title each idea as one plain sentence that names the place and what replaces it.
Rate severity by what breaks if the call site is moved wrongly: payments, sign-in and data writes are high or critical; display-only code is low.
In each idea's check, use `pattern-absent` on the old module's import or name, in that one file only.
If the project does not name a replacement for something, skip it rather than guess.
Change nothing: the only files you write are the ideas.
