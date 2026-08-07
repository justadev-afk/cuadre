/**
 * Phosphor, the icon family the design system specifies.
 *
 * A component rather than a bare `<i className="ph ph-x">` so the family
 * prefix lives in one place: the stylesheet is loaded from a CDN today and
 * will be a self-hosted subset once the icon set stops moving, and that swap
 * should be one edit rather than two hundred.
 */

export type IconName =
  | 'arrow-left'
  | 'arrow-right'
  | 'arrows-clockwise'
  | 'bank'
  | 'broadcast'
  | 'calendar-blank'
  | 'caret-down'
  | 'caret-left'
  | 'caret-right'
  | 'cash-register'
  | 'check'
  | 'check-circle'
  | 'check-square-offset'
  | 'circle'
  | 'clock-counter-clockwise'
  | 'clock-user'
  | 'copy'
  | 'download-simple'
  | 'eye'
  | 'flask'
  | 'funnel'
  | 'info'
  | 'key'
  | 'list'
  | 'lock-key'
  | 'magnifying-glass'
  | 'pencil-simple'
  | 'plugs-connected'
  | 'plus'
  | 'printer'
  | 'receipt'
  | 'shield-check'
  | 'sign-out'
  | 'storefront'
  | 'trash'
  | 'tray'
  | 'warning-circle'
  | 'x';

type IconProps = {
  name: IconName;
  /** Icons here are decorative: the label beside them carries the meaning. */
  size?: number | string;
  className?: string;
  style?: React.CSSProperties;
};

export function Icon({ name, size, className, style }: IconProps) {
  return (
    <i
      // Decorative by default. Where an icon is the only content of a control,
      // the control carries an aria-label instead — an icon font read aloud is
      // a private-use codepoint, which is worse than silence.
      aria-hidden="true"
      className={className ? `ph ph-${name} ${className}` : `ph ph-${name}`}
      style={size === undefined ? style : { fontSize: size, ...style }}
    />
  );
}
