# Dashboard

Compose saved Eidos views and ordinary files, including plugin file views, in a `.dashboard` file.
The file contains JSON layout and relative references; data stays in its source files.

Requires **Eidos Lite 0.22.1 or later** with plugin API 3.2.0.
Install the package or load `plugin.json` as a development source, enable it in
the Space, then choose **New File → Dashboard**. Add a file and choose a saved
view for `.eidos` files. Chart 0.3.2 supports a compact embedded presentation.

Panels show only their title and content. Hover or focus a panel to reveal its
actions menu. Choose **Edit layout** to rename, reorder or resize panels.
Use the panel handle to drag. With the handle focused, press Space, use arrows
to choose a position, then Enter to place or Escape to cancel. Width and height
are adjusted by dragging the right edge, bottom edge or bottom-right corner.
Dragging previews the resulting layout live; releasing applies one undoable change.
Escape cancels the gesture. Focus a resize edge and use arrow keys for keyboard resizing.
Save or Command/Ctrl+S persists layout. Undo and Redo
use the host document history. File conflicts retain the working copy; stale
edits preserve proposed JSON in a recovery field.

Up to 12 read-only panels are supported. References stay inside the current
Space and resolve from the configuration file's directory. Nested dashboards,
cross-Space references, global filter linking and whole-dashboard image export
are not part of this version. Eidos panels respond to Space updates; ordinary
file previews have a Refresh action in the panel menu. Unavailable files/plugins show a panel error.

## Development

Use Node.js 22.12 or later and the published plugin SDK and authoring tools:

```sh
npm install
npm test
npm run check -- --target lite --json
npm run pack:plugin -- --json
```

The packed archive bundles the plugin and has no dependency on these source paths.
The host owns resource rendering, permissions, relative path checks and file creation.
The plugin edits only its configuration through the versioned document API.
