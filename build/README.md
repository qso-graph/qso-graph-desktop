# Build resources

`icon.png` is the application icon electron-builder turns into `icon.icns` for
the macOS bundle, and into the Windows and Linux icons when those platforms are
packaged.

**The current icon is a placeholder.** KI7MT is choosing the design; this one is
in place so the packaged application is not shipping Electron's default. It was
cut from a generated source that had its transparency painted on as a
checkerboard — JPEG carries no alpha — so the alpha here was keyed and the
squircle edge produced by area-averaging 1638px down to 1024.

Replacing it is a drop-in: the same path, 1024×1024, with real transparency
outside the rounded tile. `package.json` names it explicitly for all three
platforms, so a rename or a move fails the build rather than quietly falling
back to the default icon.
