interface BrandMarkProps {
  size?: number;
}

export function BrandMark({ size = 34 }: BrandMarkProps) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="-3 -3 46 46">
      <circle cx="20" cy="7" r="7.5" fill="#2f6bff" />
      <circle cx="33" cy="20" r="7.5" fill="#e5484d" />
      <circle cx="20" cy="33" r="7.5" fill="#f4b400" />
      <circle cx="7" cy="20" r="7.5" fill="#34b24a" />
    </svg>
  );
}
