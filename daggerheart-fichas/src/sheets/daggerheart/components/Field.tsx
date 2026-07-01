import type {
  InputHTMLAttributes,
  ReactNode,
  TextareaHTMLAttributes,
} from "react";

type FieldProps = {
  label: ReactNode;
  id: string;
  name?: string;
  hint?: ReactNode;
  wrapperClassName?: string;
} & InputHTMLAttributes<HTMLInputElement>;

export function Field({
  label,
  id,
  name = id,
  hint,
  wrapperClassName = "",
  ...props
}: FieldProps) {
  return (
    <div className={wrapperClassName}>
      <label htmlFor={id}>{label}</label>
      <input id={id} name={name} {...props} />
      {hint ? <span className="dh-hint">{hint}</span> : null}
    </div>
  );
}

type TextAreaFieldProps = {
  label: ReactNode;
  id: string;
  name?: string;
  wrapperClassName?: string;
} & TextareaHTMLAttributes<HTMLTextAreaElement>;

export function TextAreaField({
  label,
  id,
  name = id,
  wrapperClassName = "",
  ...props
}: TextAreaFieldProps) {
  return (
    <div className={wrapperClassName}>
      <label htmlFor={id}>{label}</label>
      <textarea id={id} name={name} {...props} />
    </div>
  );
}

export function CheckboxInline({
  name,
  children,
  defaultChecked,
  className = "",
}: {
  name: string;
  children: ReactNode;
  defaultChecked?: boolean;
  className?: string;
}) {
  return (
    <label className={`dh-checkbox-inline ${className}`}>
      <input type="checkbox" name={name} defaultChecked={defaultChecked} />
      {children}
    </label>
  );
}
