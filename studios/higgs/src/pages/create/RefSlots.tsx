import { messages, useT } from "../../i18n.ts";
import { UploadSlot, type SlotValue } from "../../ui/UploadSlot.tsx";

const M = messages(
  {
    "reference": "Reference",
    "add": "Add references",
    "another": "Add another",
    "upTo": "Up to {max} images",
  },
  {
    "reference": "레퍼런스",
    "add": "레퍼런스 추가",
    "another": "추가",
    "upTo": "이미지 최대 {max}개",
  },
);

interface Props {
  values: readonly SlotValue[];
  max: number;
  onChange: (values: SlotValue[]) => void;
  label?: string;
  accept?: string;
}

/** A growing row of single-file slots, up to max. */
export function RefSlots({ values, max, onChange, label, accept = "image/*" }: Props) {
  const t = useT(M);
  const filled = values.slice(0, max);
  const showEmpty = filled.length < max;
  return (
    <div className="slots slots-grid">
      {filled.map((value, index) => (
        <UploadSlot
          key={value.upload.inputId}
          label={(label ?? t("reference")) + " " + (index + 1)}
          role="reference-image"
          accept={accept}
          value={value}
          onChange={(next) =>
            onChange(next ? filled.map((v, i) => (i === index ? next : v)) : filled.filter((_, i) => i !== index))
          }
        />
      ))}
      {showEmpty ? (
        <UploadSlot
          label={t(filled.length === 0 ? "add" : "another")}
          role="reference-image"
          accept={accept}
          value={null}
          hint={t("upTo", { max })}
          onChange={(next) => {
            if (next) onChange([...filled, next]);
          }}
        />
      ) : null}
    </div>
  );
}
