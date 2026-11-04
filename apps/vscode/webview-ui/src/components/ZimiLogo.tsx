import { useExtensionImageUrl } from "./hooks/useExtensionImageUrl";

export function ZimiLogo({ className }: { className?: string }) {
  const logoUrl = useExtensionImageUrl("zimi-logo.png");

  if (!logoUrl) {
    return null;
  }

  return <img src={logoUrl} alt="ZIMI" className={className} aria-label="ZIMI" />;
}
