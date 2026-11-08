# Selective UI ports

These changes retain the overall revision in `UPSTREAM` and the editor's local
adaptations documented in `README.md`.

- Light secondary text and table-cell text follow upstream
  [`17557389c583ad16eade24a04a767b42671a5a08`](https://github.com/DilsonsPickles/audacity-design-system/commit/17557389c583ad16eade24a04a767b42671a5a08).
  Icons retain their existing color. The focused contrast regression checks AA
  against every light panel and table surface.

- Notification behavior follows the upstream November 2 toast redesign through
  `487031cbd6ca84925ae24b8570404ccd70b50801`, adapted in the editor's controlled
  `EditorToast`. Hover and focus pause remaining reading time; actions, errors,
  progress, and persistent notices do not expire. The stack stays bounded and
  anchored at the top. View → Notifications opens session history and optional
  mute. History holds at most 100 text records and never retains project action
  callbacks; progress is excluded. Muting applies to new informational notices,
  while actions, errors, progress, and persistent notices remain visible. No
  notification bell or permanent panel is added.
