# Security review

Review this project as a security engineer would before it goes live. Report weaknesses someone
could take advantage of, in words the owner, who is not technical, can follow.

- **Passwords and keys written in the code**: passwords, API keys, tokens and private keys in any
  file, including settings and examples. Copy the line exactly as the anchor, with
  `scope: repo` and `sensitive: true`. Say under "What fixed looks like" that the secret has already been seen and
  must be changed where it was issued: only a person can do that.
- **Outside input reaching commands or queries**: input that reaches SQL, a shell, a file path,
  a template or HTML without being made safe.
- **Missing checks on who may do what**: routes, functions or files that act for anyone when only
  some people should be able to.
- **Unsafe default settings**: debugging on, certificate checks off, sharing between sites open
  to all, weak defaults left in.
- **Library versions known to be unsafe**: only versions you know to have a published weakness,
  read from `package-lock.json`. Use the `dependency-absent` check with the exact package and
  version. You have no advisory database: say what you know and nothing more.

Under "Why it matters", say in one or two plain sentences what someone
could do and to whom, without technical terms. Never repeat a password, key or token anywhere
except the check's anchor.

Rate each weakness's severity by these bands:

- **low**: Hard to take advantage of, and little harm if someone did.
- **medium**: Someone could take advantage of it in some situations, or with some access already, and cause limited harm.
- **high**: Someone could take advantage of it in normal use and cause serious harm, such as reading or changing data they should not.
- **critical**: Anyone could take advantage of it easily, with no special access, and take over the project, its data or its accounts.

Prefer fewer, certain problems to many guesses.
