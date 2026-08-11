# Shared UI Components

This directory contains the standardized shared component library for RISpro, unified as part of the theming consolidation project.

All components use the existing design system CSS variables and produce **zero visual changes** while providing a consistent API across the application.

---

## Usage

All components can be imported from the shared index:

```tsx
import { Button, Card, Input, LoadingState, EmptyState, ErrorState } from "@/components/shared";
```

---

## Available Components

### Button (`Button.tsx`)
Standard button component wrapping the existing production-tested button classes.

```tsx
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

### SearchInput (`SearchInput.tsx`)
Search input component with built-in search icon and clear button.

```tsx
<SearchInput
  value={query}
  onChange={(e) => setQuery(e.target.value)}
  placeholder="Search..."
  showClearButton
  onClear={() => setQuery("")}
  isLoading={isSearching}
/>
```

**Props**:
- `showClearButton`: boolean
- `onClear`: () => void
- `isLoading`: boolean
- All standard input HTML attributes

---

### Badge (`Badge.tsx`)
Standard status badge component with standardized color variants.

```tsx
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

### LoadingState (`LoadingState.tsx`)
Standardized loading state component with spinner.

```tsx
<LoadingState message="Loading data..." />
```

**Props**:
- `message`: string (default: "Loading...")

---

### EmptyState (`EmptyState.tsx`)
Standardized empty state component.

```tsx
<EmptyState message="No results found" icon={<Search size={32} />} />
```

**Props**:
- `message`: string (default: "No data available")
- `icon`: React.ReactNode

---

### ErrorState (`ErrorState.tsx`)
Standardized error state component with retry button.

```tsx
<ErrorState message="Failed to load data" onRetry={handleRetry} />
```

**Props**:
- `message`: string (default: "An error occurred")
- `onRetry`: () => void

---

### Table Components (`Table.tsx`)
Composable table components with standard styling.

```tsx
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/shared";

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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/shared";

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

## Usage Contract

Use these components for ordinary application UI when their semantics and layout match the target. Preserve existing class overrides and component-specific geometry during migrations.

Native or local controls remain valid when they provide domain-specific interaction, deliberately different layout semantics, or geometry that a shared primitive cannot preserve cleanly. Do not force dense operational tables, segmented workflow controls, radio groups, disclosure triggers, or content-specific overlays into a generic primitive merely because their JSX looks similar.

Reuse the existing variables and canonical classes in `frontend/src/index.css`; do not create a parallel design system. UI normalization requires rendered desktop/mobile parity checks and is not permission to redesign a page.

Migration is incremental. Appointments V2, Registration, and Modality Board already use many shared primitives while retaining documented specialized controls. Consult `docs/plans/active/ui-normalization.md` for the current inventory and exception ledger.

## Historical Migration Notes

The checklist below predates the current source inventory. Treat it as historical context, not a claim that every generic seam or dialog in those pages is normalized.

All major pages have been migrated to use these shared components:
- ✅ V2 Appointments page
- ✅ Dashboard page
- ✅ Queue page
- ✅ Settings page
- ✅ Registration page

All dialog components have been standardized:
- ✅ CancelConfirmDialog
- ✅ RescheduleDialog
- ✅ PublishPolicyDialog
- ✅ OverrideDialog

All components maintain 100% backwards compatibility with existing styles and produce zero visual changes.
