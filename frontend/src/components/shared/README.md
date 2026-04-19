# Shared UI Components

This directory contains the standardized shared component library for RISpro, unified as part of the theming consolidation project.

All components use the existing design system CSS variables and produce **zero visual changes** while providing a consistent API across the application.

---

## Available Components

### Button (`Button.tsx`)
Standard button component wrapping the existing production-tested button classes.

```tsx
import { Button } from "@/components/shared/Button";

// Primary button (default)
<Button onClick={handleAction}>Submit</Button>

// Secondary button
<Button variant="secondary">Cancel</Button>

// Ghost button
<Button variant="ghost">Reset</Button>

// Small size
<Button size="sm">Action</Button>

// Icon size (square)
<Button size="icon"><Icon /></Button>
```

**Props**:
- `variant`: "primary" (default) | "secondary" | "ghost"
- `size`: "default" (default) | "sm" | "icon"
- All standard button HTML attributes

---

### Card (`Card.tsx`)
Standard card container component using the existing neumorphic card styles.

```tsx
import { Card } from "@/components/shared/Card";

// Default card
<Card>Content</Card>

// Elevated variant
<Card variant="elevated">Content</Card>

// Compact padding
<Card variant="compact">Content</Card>
```

**Props**:
- `variant`: "default" (default) | "elevated" | "compact"
- All standard div HTML attributes

---

### Input (`Input.tsx`)
Standard input component wrapping the existing premium input styles.

```tsx
import { Input } from "@/components/shared/Input";

<Input
  type="text"
  value={value}
  onChange={handleChange}
  placeholder="Enter text..."
/>
```

**Props**:
- All standard input HTML attributes

---

### Badge (`Badge.tsx`)
Standard status badge component with standardized color variants.

```tsx
import { Badge } from "@/components/shared/Badge";

<Badge variant="success">Active</Badge>
<Badge variant="warning">Pending</Badge>
<Badge variant="error">Failed</Badge>
<Badge variant="info">Info</Badge>
<Badge variant="neutral">Neutral</Badge>
```

**Props**:
- `variant`: "success" | "warning" | "error" | "info" | "neutral"
- `size`: "default" | "sm"
- All standard span HTML attributes

---

### Table Components (`Table.tsx`)
Composable table components with standard styling.

```tsx
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/shared/Table";

<Table>
  <TableHeader>
    <TableRow>
      <TableHead>Column 1</TableHead>
      <TableHead>Column 2</TableHead>
    </TableRow>
  </TableHeader>
  <TableBody>
    <TableRow>
      <TableCell>Value 1</TableCell>
      <TableCell>Value 2</TableCell>
    </TableRow>
  </TableBody>
</Table>
```

**Components**:
- `Table` - Root table container
- `TableHeader` - Sticky header section
- `TableBody` - Table body with divider lines
- `TableRow` - Table row with hover states
- `TableHead` - Header cell
- `TableCell` - Data cell

---

### Dialog Components (`Dialog.tsx`)
Accessible dialog/modal base components with keyboard navigation and backdrop click support.

```tsx
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/shared/Dialog";

<Dialog open={isOpen} onClose={handleClose}>
  <DialogContent maxWidth="500px">
    <DialogHeader>
      <DialogTitle>Dialog Title</DialogTitle>
      <DialogDescription>Dialog description text.</DialogDescription>
    </DialogHeader>

    <div>Dialog content goes here</div>

    <DialogFooter>
      <Button variant="secondary" onClick={handleClose}>Cancel</Button>
      <Button onClick={handleConfirm}>Confirm</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

**Components**:
- `Dialog` - Root context provider
- `DialogContent` - Modal container
- `DialogHeader` - Header with optional close button
- `DialogTitle` - Title text
- `DialogDescription` - Secondary text
- `DialogFooter` - Action button container

---

## Migration Status

All major pages have been migrated to use these shared components:
- ✅ V2 Appointments page
- ✅ Dashboard page
- ✅ Queue page
- ✅ Settings page
- ✅ Registration page

All components maintain 100% backwards compatibility with existing styles and produce zero visual changes.
