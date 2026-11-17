# License Boundaries

- This repository and its checker gate: MIT.
- `lsh8848/cm-Workers-CheckSocks5`: GPL-3.0, deployed as a separate Worker pinned by commit.
- `cmliu/edgetunnel`: GPL-2.0, deployed as a separate Worker pinned by commit.
- The deployment orchestrator clones GPL sources into ignored `.build/external/` at deploy time.
- No GPL source is copied into, linked into, or committed to the MIT core.
- Do not distribute a combined closed-source package containing the GPL services without compliance review.

Pinned revisions:

```text
CheckSocks5  2f31cf9a242444eb22905d888d4d8871b0625b3a
edgetunnel   24ee0b6 (lightweight stable; MD5 compatibility patch applied at deploy time)
```
