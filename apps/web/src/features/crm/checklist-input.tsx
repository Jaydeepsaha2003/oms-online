import { useState } from 'react';
import { Check, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export interface ChecklistDraftItem {
  text: string;
}

/** A simple type-and-add task list — used on the follow-up form to build (or
 *  add to) a checklist of sub-tasks. */
export function ChecklistInput({
  items,
  onChange,
  placeholder = 'Type a task and press Enter…',
}: {
  items: ChecklistDraftItem[];
  onChange: (items: ChecklistDraftItem[]) => void;
  placeholder?: string;
}) {
  const [text, setText] = useState('');

  const add = () => {
    const v = text.trim();
    if (!v) return;
    onChange([...items, { text: v }]);
    setText('');
  };
  const remove = (i: number) => onChange(items.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          className="h-11"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          placeholder={placeholder}
        />
        <Button type="button" variant="outline" className="h-11 shrink-0" onClick={add} disabled={!text.trim()}>
          <Plus className="size-4" />
        </Button>
      </div>
      {items.length > 0 && (
        <ul className="space-y-1.5">
          {items.map((it, i) => (
            <li key={i} className="flex items-center gap-2 rounded-lg border bg-white px-3 py-2 text-sm">
              <span className="flex size-5 shrink-0 items-center justify-center rounded border border-slate-300 text-slate-400">
                <Check className="size-3" />
              </span>
              <span className="flex-1">{it.text}</span>
              <button type="button" onClick={() => remove(i)} className="text-slate-300 hover:text-rose-500" aria-label="Remove task">
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
