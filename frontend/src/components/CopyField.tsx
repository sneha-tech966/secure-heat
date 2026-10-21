import { useState } from 'react';
export function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div><span className="label">{label}</span>
      <div className="flex gap-2"><input readOnly aria-label={label} className="input font-mono text-xs" value={value} onFocus={(e) => e.currentTarget.select()} />
        <button className="btn-ghost shrink-0" onClick={() => { void navigator.clipboard?.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}>{copied ? 'Copied' : 'Copy'}</button></div></div>
  );
}
