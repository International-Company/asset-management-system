import { FormEvent, useState } from 'react';
import { fieldErrors, FormAlert, TextField } from '../../components/Form';
import { Modal } from '../../components/Modal';

/** Small dialog to create or rename a named record (location, department, subcategory). */
export function NameDialog({
  title,
  label,
  initial = '',
  pending,
  error,
  submit,
  onClose,
}: {
  title: string;
  label: string;
  initial?: string;
  pending: boolean;
  error: unknown;
  submit: (name: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial);
  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await submit(name.trim());
      onClose();
    } catch {
      // Shown via `error`.
    }
  };
  return (
    <Modal open title={title} onClose={onClose}>
      <form onSubmit={onSubmit}>
        <FormAlert error={error} />
        <TextField label={label} value={name} onChange={(e) => setName(e.target.value)} autoFocus required maxLength={150} error={fieldErrors(error).name} />
        <button type="submit" className="btn btn-primary" disabled={pending || !name.trim()}>
          {pending ? 'جارٍ الحفظ…' : 'حفظ'}
        </button>
      </form>
    </Modal>
  );
}
