import type { Metadata } from 'next';

/**
 * The one place a page's `<title>` is shaped, so every tab across the app reads
 * the same way and the word "Cuadre" is never printed twice.
 *
 * A page passes only its own subtitle — `pageMeta('Bancos')`, `pageMeta('Caja')`
 * — and that string *is* the document title. The brand is deliberately **not**
 * appended here, because it already lives elsewhere and stacks otherwise:
 *
 *  - The installed PWA composes its window title as `<app name> - <document
 *    title>`, and the app name is the manifest's "Cuadre — validación de pago
 *    móvil". A "· Cuadre" suffix on the document title then prints Cuadre twice
 *    in the one title bar a cashier stares at all shift.
 *  - A plain browser tab still identifies the app: the section name is enough,
 *    and the bare root falls back to "Cuadre" (the root layout's `default`).
 *
 * So the brand is owned by the manifest and the root default; every page owns
 * only its subtitle. Change the brand strategy here, in one function, not in
 * fifteen page files.
 */
export function pageMeta(subtitle: string): Metadata {
  return { title: subtitle };
}
