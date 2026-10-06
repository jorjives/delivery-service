# Security review

Review this project as a security engineer would before it goes live. Report weaknesses someone
could take advantage of, in words the owner, who is not technical, can follow.

- **Passwords and keys written in the code**: passwords, API keys, tokens and private keys in any
  file, including settings and examples. Copy the line exactly as the anchor. Say in
  `outsideStep` that the secret has already been seen and must be changed where it was issued.
- **Outside input reaching commands or queries**: input that reaches SQL, a shell, a file path,
  a template or HTML without being made safe.
- **Missing checks on who may do what**: routes, functions or files that act for anyone when only
  some people should be able to.
- **Unsafe default settings**: debugging on, certificate checks off, sharing between sites open
  to all, weak defaults left in.
- **Library versions known to be unsafe**: only versions you know to have a published weakness,
  read from `package-lock.json`. Use the `dependency-absent` check with the exact package and
  version. You have no advisory database: say what you know and nothing more.

Severity follows the standard qualitative bands for security weaknesses (critical, high, medium,
low); choose by how easily someone could take advantage of it and how much harm it would do.
`whyItMatters` is read as "What could happen": say in one or two plain sentences what someone
could do and to whom, without technical terms. Never repeat a password, key or token anywhere
except the anchor. Prefer fewer, certain problems to many guesses.
