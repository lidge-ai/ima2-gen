import { UploadSlot, type SlotValue } from "../../ui/UploadSlot.tsx";

interface Props {
  values: readonly SlotValue[];
  max: number;
  onChange: (values: SlotValue[]) => void;
  label?: string;
  accept?: string;
}

/** A growing row of single-file slots, up to max. */
export function RefSlots({ values, max, onChange, label = "Reference", accept = "image/*" }: Props) {
  const filled = values.slice(0, max);
  const showEmpty = filled.length < max;
  return (
    <div className="slots slots-grid">
      {filled.map((value, index) => (
        <UploadSlot
          key={value.upload.inputId}
          label={label + " " + (index + 1)}
          role="reference-image"
          accept={accept}
          value={value}
          onChange={(next) => onChange(next ? filled.map((v, i) => (i === index ? next : v)) : filled.filter((_, i) => i !== index))}
        />
      ))}
      {showEmpty ? (
        <UploadSlot
          label={filled.length === 0 ? "Add references" : "Add another"}
          role="reference-image"
          accept={accept}
          value={null}
          hint={"Up to " + max + " images"}
          onChange={(next) => { if (next) onChange([...filled, next]); }}
        />
      ) : null}
    </div>
  );
}
