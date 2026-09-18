# Contribution Workflow

## Branching Model

- `master` — stable release branch. Never push directly.
- `develop` — integration branch. All PRs target this branch.
- Feature branches: `feature/<short-description>`
- Bug fix branches: `bugfix/<short-description>`

## Pull Request Process

1. Create a branch from `develop`.
2. Make focused, logical commits (avoid large monolithic changes).
3. Rebase or merge with upstream `develop` and resolve conflicts before opening a PR.
4. Open a PR against the `develop` branch.
5. PR description should include:
   - What problem is being solved
   - How it was implemented
   - Limitations or side effects
   - Testing instructions
   - New test files or sample captures added

## Commit Guidelines

- Write clear, concise commit messages.
- Break work into logical parts — one concern per commit where practical.
- Do not mix formatting changes with functional changes.

## Adding New Modules

When introducing a new library module:

1. Create the directory under `src/nfc-lib/lib-<group>/<module-name>/`.
2. Follow the standard layout: `src/main/cpp/` for sources, `src/main/include/` for public headers.
3. Add a `CMakeLists.txt` that sets `CMAKE_CXX_STANDARD 17` and declares the static library target.
4. Register the new subdirectory in the parent `CMakeLists.txt`.
5. Add documentation or examples for the new module.

## Adding New Hardware Drivers

1. Place driver implementation under `src/nfc-lib/lib-hw/hw-radio/src/main/cpp/<driver-name>/`.
2. Add the public header to `src/main/include/hw/radio/`.
3. Register source files in `hw-radio/CMakeLists.txt`.
4. If the driver depends on an external library, add a `cmake/Findlib<name>.cmake` module and handle the "not found" fallback (bundled static or skip).

## Third-Party Dependencies

- Keep track of licenses; ensure compatibility with GPL-3.0.
- Bundled third-party code goes in `src/nfc-lib/lib-ext/`.
- Document new dependencies in PR descriptions.
- For system libraries, use pkg-config or CMake find modules.

## License

All contributions are licensed under GPL-3.0-or-later. By submitting a PR, you agree that your work is original (or properly licensed) and will be distributed under the same license.

Every new source and header file must include the standard GPL-3.0 license header:

```cpp
/*

  This file is part of NFC-LABORATORY.

  Copyright (C) 2024 Jose Vicente Campos Martinez, <josevcm@gmail.com>

  NFC-LABORATORY is free software: you can redistribute it and/or modify
  it under the terms of the GNU General Public License as published by
  the Free Software Foundation, either version 3 of the License, or
  (at your option) any later version.

  NFC-LABORATORY is distributed in the hope that it will be useful,
  but WITHOUT ANY WARRANTY; without even the implied warranty of
  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
  GNU General Public License for more details.

  You should have received a copy of the GNU General Public License
  along with NFC-LABORATORY. If not, see <http://www.gnu.org/licenses/>.

*/
```
