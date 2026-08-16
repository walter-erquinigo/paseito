import { useMemo } from "react";
import { Image } from "react-native";

interface PaseoLogoProps {
  size?: number;
  color?: string;
}

/* eslint-disable @typescript-eslint/no-require-imports */
const paseitoMark = require("../../../assets/images/android-icon-foreground.png");
/* eslint-enable @typescript-eslint/no-require-imports */

// The exported name stays stable to avoid churning upstream imports; the mark is Paseito's
// solar-sail journey identity and intentionally does not reuse Paseo's loop artwork.
export function PaseoLogo({ size = 64, color }: PaseoLogoProps) {
  const imageStyle = useMemo(
    () => ({ width: size, height: size, tintColor: color }),
    [color, size],
  );

  return <Image source={paseitoMark} resizeMode="contain" style={imageStyle} />;
}
