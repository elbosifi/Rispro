import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/shared/Dialog";
import { Button } from "@/components/shared/Button";
import { Input } from "@/components/shared/Input";

export function PublishPolicyDialog({
  isOpen,
  onClose,
  onPublish,
  isPublishing,
}: {
  isOpen: boolean;
  onClose: () => void;
  onPublish: (changeNote: string | null) => Promise<void>;
  isPublishing: boolean;
}) {
  const [changeNote, setChangeNote] = useState("");

  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onClose={onClose}>
      <DialogContent maxWidth="540px">
        <DialogHeader showClose={false}>
          <DialogTitle>Publish Draft Policy</DialogTitle>
          <DialogDescription>
            This publishes the draft and makes it active for V2 scheduling.
          </DialogDescription>
        </DialogHeader>

        <Input
          type="text"
          placeholder="Publish note (optional)"
          value={changeNote}
          onChange={(e) => setChangeNote(e.target.value)}
          className="mb-4"
        />

        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={isPublishing}
            onClick={() => onPublish(changeNote.trim() || null)}
            style={{ backgroundColor: "var(--blue)", color: "#fff" }}
          >
            {isPublishing ? "Publishing..." : "Publish"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

