import { useQuery } from '@tanstack/react-query';
import { Pill } from 'lucide-react';
import type { ReactElement } from 'react';
import { api } from '../../lib/api';

/**
 * Cached data URL of a product photo. The bytes are fetched through the API
 * bridge only for products whose `hasImage` flag is set, so catalogue queries
 * stay free of image payloads.
 */
export function useProductImage(productId: string, hasImage: boolean) {
  return useQuery({
    queryKey: ['product-image', productId],
    queryFn: async () => {
      const payload = await api.products.image(productId);
      return `data:${payload.mimeType};base64,${payload.dataBase64}`;
    },
    enabled: hasImage,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    retry: 1,
  });
}

/**
 * Renders a product photo. While the photo loads — and forever when the
 * product has none — the classic pill icon is shown, exactly as before photos
 * existed.
 */
export function ProductThumb({
  productId,
  hasImage,
  alt = '',
  iconSize = 26,
  placeholderClassName,
  imageClassName,
}: {
  productId: string;
  hasImage: boolean | undefined;
  alt?: string;
  /** Pixel size of the fallback pill icon. */
  iconSize?: number;
  /** Class of the placeholder wrapper (POS cards use `placeholder-icon`). */
  placeholderClassName?: string;
  imageClassName?: string;
}): ReactElement {
  const photo = useProductImage(productId, Boolean(hasImage));

  if (hasImage && photo.data) {
    return <img src={photo.data} alt={alt} loading="lazy" className={imageClassName} />;
  }

  return (
    <div className={placeholderClassName}>
      <Pill size={iconSize} aria-hidden="true" />
    </div>
  );
}
