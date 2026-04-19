import { HTMLAttributes, forwardRef } from "react";

const Table = forwardRef<HTMLTableElement, HTMLAttributes<HTMLTableElement>>(
  ({ className = "", children, ...props }, ref) => {
    return (
      <table ref={ref} className={`w-full text-sm ${className}`} {...props}>
        {children}
      </table>
    );
  }
);

const TableHeader = forwardRef<HTMLTableSectionElement, HTMLAttributes<HTMLTableSectionElement>>(
  ({ className = "", children, ...props }, ref) => {
    return (
      <thead
        ref={ref}
        className={`border-b sticky top-0 bg-muted/50 backdrop-blur ${className}`}
        style={{ borderColor: "var(--border)" }}
        {...props}
      >
        {children}
      </thead>
    );
  }
);

const TableBody = forwardRef<HTMLTableSectionElement, HTMLAttributes<HTMLTableSectionElement>>(
  ({ className = "", children, ...props }, ref) => {
    return (
      <tbody
        ref={ref}
        className={`divide-y ${className}`}
        style={{ borderColor: "var(--border)" }}
        {...props}
      >
        {children}
      </tbody>
    );
  }
);

const TableRow = forwardRef<HTMLTableRowElement, HTMLAttributes<HTMLTableRowElement>>(
  ({ className = "", children, ...props }, ref) => {
    return (
      <tr
        ref={ref}
        className={`transition-colors hover:bg-muted ${className}`}
        {...props}
      >
        {children}
      </tr>
    );
  }
);

const TableHead = forwardRef<HTMLTableCellElement, HTMLAttributes<HTMLTableCellElement>>(
  ({ className = "", children, ...props }, ref) => {
    return (
      <th
        ref={ref}
        className={`text-left p-3 font-bold text-xs uppercase tracking-[0.08em] text-muted-foreground ${className}`}
        style={{ color: "var(--text-muted)" }}
        {...props}
      >
        {children}
      </th>
    );
  }
);

const TableCell = forwardRef<HTMLTableCellElement, HTMLAttributes<HTMLTableCellElement>>(
  ({ className = "", children, ...props }, ref) => {
    return (
      <td
        ref={ref}
        className={`p-3 ${className}`}
        {...props}
      >
        {children}
      </td>
    );
  }
);

Table.displayName = "Table";
TableHeader.displayName = "TableHeader";
TableBody.displayName = "TableBody";
TableRow.displayName = "TableRow";
TableHead.displayName = "TableHead";
TableCell.displayName = "TableCell";

export { Table, TableHeader, TableBody, TableRow, TableHead, TableCell };
