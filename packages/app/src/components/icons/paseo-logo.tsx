import Svg, { Circle, Defs, Ellipse, LinearGradient, Rect, Stop } from "react-native-svg";

interface PaseoLogoProps {
  size?: number;
  color?: string;
}

// The exported name stays stable to avoid churning upstream imports; the mark is Paseito's
// original stepping-stone identity and intentionally does not reuse Paseo's loop artwork.
export function PaseoLogo({ size = 64, color }: PaseoLogoProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" fill="none">
      <Defs>
        <LinearGradient id="paseito-stones" x1="20" y1="82" x2="72" y2="30">
          <Stop offset="0" stopColor="#FF5C58" />
          <Stop offset="1" stopColor="#FFD34E" />
        </LinearGradient>
      </Defs>
      <Rect x="3" y="3" width="94" height="94" rx="22" fill={color ?? "#081A33"} />
      <Ellipse cx="28" cy="73" rx="16" ry="8" fill="url(#paseito-stones)" />
      <Ellipse cx="45" cy="58" rx="12" ry="6" fill="url(#paseito-stones)" />
      <Ellipse cx="59" cy="45" rx="9" ry="4.5" fill="url(#paseito-stones)" />
      <Ellipse cx="70" cy="34" rx="6.5" ry="3.4" fill="url(#paseito-stones)" />
      <Circle cx="79" cy="23" r="5.5" fill="#64F0C5" />
    </Svg>
  );
}
