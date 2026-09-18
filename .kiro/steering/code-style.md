# Code Style

This project uses CLion's formatter. The configuration is in `src/clion-c++-formatter.xml`.

## Indentation

- Indent size: 3 spaces
- Tab size: 3 spaces
- Continuation indent: 6 spaces
- Do NOT use tabs; use spaces only

## Braces

- Functions: next line (Allman style)
- Namespaces: end of line (K&R style), content NOT indented
- Control flow (if, for, while, switch): end of line
- Case blocks: next line

## Naming Conventions

| Element | Style | Example |
|---------|-------|---------|
| Classes / Structs | PascalCase | `RadioDevice`, `SignalBuffer` |
| Methods / Functions | camelCase | `isStreaming()`, `getLogger()` |
| Local variables | camelCase | `centerFreq`, `sampleRate` |
| Member variables | camelCase (no prefix) | `deviceName`, `streamQueue` |
| Constants / Macros | UPPER_SNAKE_CASE | `MAX_QUEUE_SIZE`, `DEVICE_TYPE_PREFIX` |
| Namespaces | lowercase, nested with `::` | `hw::radio`, `lab::nfc` |
| Enum values | UPPER_SNAKE_CASE | `PARAM_TUNE_FREQUENCY` |
| Files (headers) | PascalCase matching class | `AirspyDevice.h` |
| Files (source) | PascalCase matching class | `AirspyDevice.cpp` |

## Spacing

- Space before pointer/reference in declarations: `int *ptr`, `const std::string &name`
- No space after pointer/reference
- Space before initializer braces: `Foo foo {1, 2}`
- No space before range-based for colon: `for(auto &item: collection)`
- Blank line after access specifiers (`public:`, `private:`, `protected:`)
- Nested namespaces on same line: `namespace hw::radio {`

## Class Layout

```cpp
namespace hw::radio {

class MyClass
{
   public:

      // Types and constants first
      enum Values { ... };
      typedef std::function<void(int)> Callback;

   public:

      // Public interface methods
      virtual bool isActive() const = 0;

   protected:

      // Protected members if needed

   private:

      // Private implementation
      struct Impl;
      std::shared_ptr<Impl> impl;
};

}
```

## General Rules

- Use PImpl idiom for classes with complex internal state
- Prefer `std::shared_ptr` for PImpl pointers (allows copying of handle objects)
- Include a GPL-3.0 license header at the top of every source and header file
- Use `#ifndef` / `#define` include guards (not `#pragma once`), named `MODULE_CLASSNAME_H`
- Keep lines under 300 characters (effectively no hard wrap)
- One blank line between function declarations/definitions
- Comment nontrivial logic; prefer clarity over brevity
