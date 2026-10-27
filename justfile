# List available recipes.
default:
    @just --list

# Build unpacked Chrome/Edge and Firefox extensions.
build:
    npm run build

# Build both extensions and their installable ZIP archives.
package:
    npm run package

# Install development dependencies for the test suite.
deps:
    npm install

# Build and run the Playwright test suite (requires development dependencies).
test:
    npm test

# Build and stage for the default browser; finish with Load unpacked in its UI.
install:
    python3 scripts/browser-extension.py install

# Open the default browser's extension UI; finish by clicking Remove on Blockwork.
uninstall:
    python3 scripts/browser-extension.py uninstall

# Rebuild and install/reinstall; click Load unpacked or Reload in the browser.
replace: install
