# purepeople app guide

Manage contacts collected across the suite, with manual curation.

## Using the app

1. Add a contact or import contacts using the available import controls.
2. Review names, addresses, organizations, roles, phone numbers, notes, and tags.
3. Merge duplicates and correct fields directly. Explicit edits are protected from automatic feed updates, which fill missing information.

## Development requirements

This app runs within [puredesktop](https://puredesktop.ai). Its local `@purescience/platform-*` dependencies, desktop bridge, and shared shell come from the parent suite and are not included in this repository. Use the matching suite development environment to install and run it; installing this repository alone is not sufficient for a complete desktop application.

With the shared dependencies available, use the scripts in `package.json` from the app directory:

```sh
npm run dev
npm run build
npm run typecheck
npm test
```

`dev` starts the development entry point; `build` prepares the app bundle. Tests and type checking require the same shared dependencies as the app. Host services such as file access and connected accounts must be provided by the suite.

## Contributing

Anyone may modify and share this app under its applicable licenses. We welcome pull requests, bug reports, and documentation improvements. See [contribution guidance](../CONTRIBUTING.md), [the license](../LICENSE), and [third-party notices](../THIRD_PARTY_NOTICES.md).
