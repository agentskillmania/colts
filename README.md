# @agentskillmania/colts

A CLI tool and library.

## Installation

### As a CLI tool

```bash
npm install -g @agentskillmania/colts
```

### As a library

```bash
npm install @agentskillmania/colts
```

## CLI Usage

```bash
colts World
# Output: Hello, World!
```

## Library Usage

```typescript
import { greet, add } from '@agentskillmania/colts';

// Greet function
console.log(greet('World'));
// Output: Hello, World!

console.log(greet('World', { greeting: 'Hi' }));
// Output: Hi, World!

// Add function
console.log(add(1, 2));
// Output: 3
```

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Watch mode
npm run dev

# Run CLI locally
npm start -- World
```

## Publishing

```bash
npm run build
npm publish --access public
```
