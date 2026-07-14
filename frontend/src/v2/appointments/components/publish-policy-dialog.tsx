import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/shared/Dialog";
import { Button } from "@/components/shared/Button";
import { Input } from "@/components/shared/Input";
import { useLanguage } from "@/providers/language-provider";

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
  const { language } = useLanguage();
  const [changeNote, setChangeNote] = useState("");

  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onClose={onClose}>
      <DialogContent maxWidth="540px">
        <DialogHeader showClose={false}>
          <DialogTitle>{language === "ar" ? "نشر مسودة السياسة" : "Publish Draft Policy"}</DialogTitle>
          <DialogDescription>
            {language === "ar" ? "سيتم نشر المسودة وجعلها فعالة لجدولة المواعيد." : "This publishes the draft and makes it active for appointment scheduling."}
          </DialogDescription>
        </DialogHeader>

        <Input
          type="text"
          placeholder={language === "ar" ? "ملاحظة النشر (اختياري)" : "Publish note (optional)"}
          value={changeNote}
          onChange={(e) => setChangeNote(e.target.value)}
          className="mb-4"
        />

        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            {language === "ar" ? "إلغاء" : "Cancel"}
          </Button>
          <Button
            disabled={isPublishing}
            onClick={() => onPublish(changeNote.trim() || null)}
            style={{ backgroundColor: "var(--blue)", color: "#fff" }}
          >
            {isPublishing ? (language === "ar" ? "جاري النشر..." : "Publishing...") : (language === "ar" ? "نشر" : "Publish")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
