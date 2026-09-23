function ictx() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.translate(64, 64);
  return { c, g };
}

function lgrad(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, stops: [number, string][]) {
  const gr = g.createLinearGradient(x0, y0, x1, y1);
  stops.forEach(([o, c]) => gr.addColorStop(o, c));
  return gr;
}

function shape(g: CanvasRenderingContext2D, fill: string | CanvasGradient, stroke: string | null, lw: number, fn: () => void) {
  g.save();
  g.beginPath();
  fn();
  g.closePath();
  g.fillStyle = fill;
  g.fill();
  if (stroke) {
    g.strokeStyle = stroke;
    g.lineWidth = lw || 2;
    g.stroke();
  }
  g.restore();
}

const STEEL = (g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) =>
  lgrad(g, x0, y0, x1, y1, [
    [0, '#eef2f6'],
    [0.45, '#aab4bf'],
    [0.55, '#6b7580'],
    [1, '#2b3138']
  ]);
const DARKSTEEL = (g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) =>
  lgrad(g, x0, y0, x1, y1, [
    [0, '#5a6068'],
    [0.5, '#2c3036'],
    [1, '#121416']
  ]);
const WOODG = (g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) =>
  lgrad(g, x0, y0, x1, y1, [
    [0, '#9a6a3e'],
    [0.5, '#6b4426'],
    [1, '#3c2515']
  ]);
const GOLD = (g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) =>
  lgrad(g, x0, y0, x1, y1, [
    [0, '#f5d98a'],
    [0.5, '#c9a04a'],
    [1, '#8a6a28']
  ]);
const POLY = (g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) =>
  lgrad(g, x0, y0, x1, y1, [
    [0, '#4a4e54'],
    [0.5, '#26282c'],
    [1, '#0e0f10']
  ]);

export const ICON_URLS: Record<string, string> = {};

function generateIcons() {
  const builders: Record<string, (g: CanvasRenderingContext2D) => void> = {
    katana: (g) => {
      g.rotate(-0.62);
      shape(g, STEEL(g, -50, 0, 44, 0), '#12151a', 1.5, () => {
        g.moveTo(-46, -3.5);
        g.lineTo(42, -2);
        g.lineTo(48, 0);
        g.lineTo(42, 2);
        g.lineTo(-46, 3.5);
      });
      shape(g, '#0d0e10', null, 0, () => g.rect(-46, -1.5, 92, 3));
      shape(g, GOLD(g, -50, -8, -50, 8), '#12151a', 1.5, () => g.rect(-52, -9, 8, 18));
      shape(g, DARKSTEEL(g, -78, 0, -52, 0), '#0d0e10', 1.5, () => g.rect(-78, -4.2, 26, 8.4));
      shape(g, GOLD(g, -84, -7, -78, 7), '#12151a', 1.4, () => g.rect(-86, -7, 6, 14));
    },
    knife: (g) => {
      g.rotate(-0.62);
      shape(g, STEEL(g, -8, 0, 46, 0), '#12151a', 1.5, () => {
        g.moveTo(-10, -8);
        g.lineTo(38, -4);
        g.lineTo(48, 0);
        g.lineTo(38, 4);
        g.lineTo(-10, 8);
      });
      shape(g, GOLD(g, -14, -9, -8, 9), '#12151a', 1.5, () => g.rect(-16, -10, 8, 20));
      shape(g, DARKSTEEL(g, -42, 0, -16, 0), '#0d0e10', 1.5, () => {
        g.moveTo(-42, -6);
        g.lineTo(-16, -6);
        g.lineTo(-16, 6);
        g.lineTo(-42, 6);
        g.quadraticCurveTo(-48, 0, -42, -6);
      });
    },
    bo: (g) => {
      g.rotate(-0.62);
      shape(g, WOODG(g, -56, -6, -56, 6), '#1a0f08', 1.5, () => g.rect(-58, -6, 116, 12));
      [-52, 46].forEach((x) => shape(g, DARKSTEEL(g, x, -7, x, 7), '#0d0e10', 1.3, () => g.rect(x, -7, 12, 14)));
    },
    kama: (g) => {
      g.rotate(-0.5);
      shape(g, WOODG(g, -46, -6, 6, 6), '#1a0f08', 1.4, () => g.rect(-46, -5, 46, 10));
      shape(g, STEEL(g, 0, -30, 40, 10), '#12151a', 1.5, () => {
        g.moveTo(0, -6);
        g.quadraticCurveTo(34, -34, 40, -6);
        g.quadraticCurveTo(30, -14, 6, 6);
      });
    },
    shuriken: (g) => {
      g.rotate(0.4);
      g.beginPath();
      g.moveTo(0, -38);
      for (let i = 0; i < 4; i++) {
        g.rotate(Math.PI / 2);
        g.lineTo(9, -9);
        g.lineTo(0, -38);
      }
      g.closePath();
      g.fillStyle = STEEL(g, -38, -38, 38, 38);
      g.fill();
      g.strokeStyle = '#12151a';
      g.lineWidth = 1.6;
      g.stroke();
      shape(g, DARKSTEEL(g, -8, -8, 8, 8), '#000', 1, () => g.arc(0, 0, 7, 0, 7));
    },
    kunai: (g) => {
      g.rotate(-0.62);
      shape(g, STEEL(g, 6, -20, 6, 20), '#12151a', 1.5, () => {
        g.moveTo(0, -34);
        g.lineTo(14, 4);
        g.lineTo(0, 14);
        g.lineTo(-14, 4);
      });
      shape(g, DARKSTEEL(g, 0, 6, 0, 40), '#0d0e10', 1.4, () => g.rect(-6, 6, 12, 34));
      shape(g, 'transparent', '#cfd6dc', 3, () => g.arc(0, 46, 8, 0, 6.6));
    },
    bomb: (g) => {
      shape(g, POLY(g, -30, -30, 24, 24), '#000', 1.6, () => g.arc(0, 8, 30, 0, 7));
      shape(g, 'rgba(255,255,255,.18)', null, 0, () => g.arc(-9, -3, 9, 0, 7));
      shape(g, GOLD(g, -4, -30, 6, -18), '#0d0e10', 1.3, () => g.rect(-3, -32, 6, 14));
      g.strokeStyle = '#c9a04a';
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(0, -32);
      g.quadraticCurveTo(14, -44, 6, -52);
      g.stroke();
      shape(g, '#ffd166', null, 0, () => g.arc(6, -53, 5, 0, 7));
      shape(g, '#ff5a20', null, 0, () => g.arc(6, -53, 2.4, 0, 7));
    },
    karate: (g) => {
      g.rotate(0.1);
      shape(
        g,
        lgrad(g, -20, -20, 20, 20, [
          [0, '#e8c1a4'],
          [1, '#a06a48']
        ]),
        '#3a2418',
        2,
        () => {
          g.moveTo(-22, 10);
          g.quadraticCurveTo(-26, -18, -10, -22);
          g.quadraticCurveTo(2, -30, 10, -20);
          g.quadraticCurveTo(20, -22, 22, -8);
          g.quadraticCurveTo(24, 10, 8, 22);
          g.quadraticCurveTo(-14, 26, -22, 10);
        }
      );
    },
    pistol: (g) => {
      g.rotate(-0.15);
      shape(g, DARKSTEEL(g, -20, -18, 40, 8), '#0d0e10', 1.6, () => {
        g.moveTo(-22, -6);
        g.lineTo(30, -8);
        g.lineTo(40, -2);
        g.lineTo(40, 4);
        g.lineTo(-22, 4);
      });
      shape(g, POLY(g, -20, 4, -6, 40), '#0d0e10', 1.6, () => {
        g.moveTo(-22, 3);
        g.lineTo(-6, 3);
        g.lineTo(-10, 38);
        g.lineTo(-22, 34);
      });
      shape(g, 'transparent', '#1a1c1f', 3, () => g.arc(-14, 12, 8, 0.3, 2.9));
      shape(g, STEEL(g, 20, -16, 20, -6), '#0d0e10', 1.2, () => g.rect(16, -16, 6, 10));
    },
    shotgun: (g) => {
      g.rotate(-0.1);
      shape(g, STEEL(g, -50, -6, 30, 6), '#0d0e10', 1.5, () => g.rect(-50, -5, 80, 10));
      shape(g, POLY(g, -20, 4, -20, 20), '#0d0e10', 1.4, () => g.rect(-24, 4, 30, 14));
      shape(g, WOODG(g, 24, -8, 54, 12), '#0d0e10', 1.4, () => {
        g.moveTo(30, -8);
        g.lineTo(54, -4);
        g.lineTo(54, 10);
        g.lineTo(30, 8);
      });
      shape(g, 'transparent', '#1a1c1f', 3, () => g.arc(6, 14, 7, 0.3, 2.9));
    },
    rifle: (g) => {
      g.rotate(-0.1);
      shape(g, DARKSTEEL(g, -46, -8, 20, 8), '#0d0e10', 1.5, () => {
        g.moveTo(-46, -6);
        g.lineTo(14, -8);
        g.lineTo(14, 6);
        g.lineTo(-46, 6);
      });
      shape(g, STEEL(g, 14, -3, 42, 3), '#0d0e10', 1.2, () => g.rect(14, -3, 30, 6));
      shape(g, POLY(g, -30, -18, -30, -34), '#0d0e10', 1.4, () => {
        g.moveTo(-34, -6);
        g.lineTo(-22, -6);
        g.lineTo(-26, -32);
        g.lineTo(-34, -32);
      });
      shape(g, WOODG(g, -60, 0, -46, 14), '#0d0e10', 1.3, () => {
        g.moveTo(-60, -2);
        g.lineTo(-46, -4);
        g.lineTo(-46, 8);
        g.lineTo(-60, 14);
      });
    },
    minigun: (g) => {
      g.rotate(-0.12);
      shape(g, POLY(g, -26, -14, -6, 14), '#0d0e10', 1.5, () => g.rect(-26, -14, 26, 28));
      for (let i = -1; i <= 1; i++) {
        shape(g, STEEL(g, 0, i * 8 - 3, 44, i * 8 + 3), '#0d0e10', 1.2, () => g.rect(-4, i * 8 - 3, 48, 6));
      }
      shape(g, DARKSTEEL(g, 40, -13, 52, 13), '#0d0e10', 1.4, () => g.arc(44, 0, 13, -1.6, 1.6));
    },
    bazooka: (g) => {
      g.rotate(-0.16);
      shape(g, DARKSTEEL(g, -50, -18, 46, 18), '#0d0e10', 1.6, () => g.rect(-50, -18, 96, 36));
      shape(g, STEEL(g, 40, -19, 40, 19), '#0d0e10', 1.6, () => g.arc(40, 0, 19, -1.6, 1.6));
      shape(g, POLY(g, -18, 16, -18, 40), '#0d0e10', 1.4, () => g.rect(-24, 16, 14, 24));
      shape(g, '#7a1f1f', '#0d0e10', 1.2, () => g.rect(24, -26, 6, 10));
    },
    flame: (g) => {
      g.rotate(-0.1);
      shape(g, POLY(g, -44, -16, 6, 16), '#0d0e10', 1.5, () => {
        g.moveTo(-44, -14);
        g.arc(-44, 0, 14, -1.6, 1.6);
        g.lineTo(6, 14);
        g.lineTo(6, -14);
      });
      shape(g, DARKSTEEL(g, 6, -6, 30, 6), '#0d0e10', 1.3, () => g.rect(6, -6, 26, 12));
      const fg = lgrad(g, 30, 0, 66, 0, [
        [0, '#fff3c4'],
        [0.35, '#ffb44a'],
        [0.7, '#ff5a20'],
        [1, 'rgba(255,60,20,0)']
      ]);
      shape(g, fg, null, 0, () => {
        g.moveTo(30, -10);
        g.quadraticCurveTo(50, -20, 66, 0);
        g.quadraticCurveTo(50, 20, 30, 10);
        g.quadraticCurveTo(40, 0, 30, -10);
      });
    },
    kage_portrait: (g) => {
      // Circular portrait frame background
      const bgGrad = g.createRadialGradient(0, 0, 10, 0, 0, 64);
      bgGrad.addColorStop(0, '#36151a');
      bgGrad.addColorStop(0.7, '#180e14');
      bgGrad.addColorStop(1, '#09080c');
      g.fillStyle = bgGrad;
      g.beginPath();
      g.arc(0, 0, 62, 0, Math.PI * 2);
      g.fill();

      // Outer Crimson Ring
      g.strokeStyle = '#c42e26';
      g.lineWidth = 3;
      g.stroke();

      // Headband fluttering ribbons in background
      shape(g, '#9e1b22', '#6b0e14', 1.5, () => {
        g.moveTo(18, -12);
        g.quadraticCurveTo(46, -20, 54, -4);
        g.quadraticCurveTo(40, -6, 20, -6);
      });
      shape(g, '#b8242c', '#6b0e14', 1.5, () => {
        g.moveTo(18, -8);
        g.quadraticCurveTo(52, -10, 56, 12);
        g.quadraticCurveTo(42, 4, 18, -2);
      });

      // Shinobi shoulders / tunic
      shape(g, '#1a1722', '#0d0b12', 2, () => {
        g.moveTo(-50, 62);
        g.quadraticCurveTo(-38, 28, -22, 22);
        g.lineTo(22, 22);
        g.quadraticCurveTo(38, 28, 50, 62);
      });

      // Flowing Crimson Scarf
      shape(g, '#c42e26', '#8e1a1e', 1.5, () => {
        g.moveTo(-32, 24);
        g.quadraticCurveTo(0, 34, 32, 22);
        g.quadraticCurveTo(38, 38, 24, 44);
        g.quadraticCurveTo(0, 48, -28, 40);
      });

      // Ninja Head / Cowl
      shape(g, '#18151f', '#0f0c14', 2, () => {
        g.arc(0, -6, 26, 0, Math.PI * 2);
      });

      // Eye Opening Strip (Skin Tone)
      shape(g, '#e0ab82', '#18151f', 1.5, () => {
        g.rect(-19, -13, 38, 14);
      });

      // Lower Ninja Mask Wrap
      shape(g, '#16131c', '#0a080f', 1.5, () => {
        g.moveTo(-20, 0);
        g.lineTo(20, 0);
        g.lineTo(15, 18);
        g.quadraticCurveTo(0, 22, -15, 18);
      });

      // Glowing Cyan Ninja Eyes
      shape(g, '#38e2ff', '#0d6b82', 1, () => {
        // Left eye
        g.moveTo(-16, -6);
        g.lineTo(-6, -8);
        g.lineTo(-5, -4);
        g.lineTo(-14, -4);
      });
      shape(g, '#38e2ff', '#0d6b82', 1, () => {
        // Right eye
        g.moveTo(6, -8);
        g.lineTo(16, -6);
        g.lineTo(14, -4);
        g.lineTo(5, -4);
      });
      // Eye glow highlights
      shape(g, '#ffffff', null, 0, () => {
        g.arc(-9, -6, 1.4, 0, Math.PI * 2);
        g.arc(9, -6, 1.4, 0, Math.PI * 2);
      });

      // Red Headband
      shape(g, '#c42e26', '#7d181e', 1.5, () => {
        g.rect(-25, -24, 50, 11);
      });

      // Metallic Hitai-ate Forehead Plate
      shape(g, STEEL(g, -18, -23, 18, -15), '#12151c', 1.5, () => {
        g.rect(-18, -23, 36, 9);
      });
      // Golden Rivets on forehead plate
      shape(g, '#f6ba38', '#12151c', 0.8, () => {
        g.arc(-15, -18.5, 1.5, 0, Math.PI * 2);
        g.arc(15, -18.5, 1.5, 0, Math.PI * 2);
      });
      // Center Engraved Emblem
      shape(g, '#1a1c22', null, 0, () => {
        g.moveTo(0, -22);
        g.lineTo(3, -18.5);
        g.lineTo(0, -15);
        g.lineTo(-3, -18.5);
      });
    },
    bravo_portrait: (g) => {
      // Circular portrait frame background
      const bgGrad = g.createRadialGradient(0, 0, 10, 0, 0, 64);
      bgGrad.addColorStop(0, '#1c281a');
      bgGrad.addColorStop(0.7, '#10170f');
      bgGrad.addColorStop(1, '#080c07');
      g.fillStyle = bgGrad;
      g.beginPath();
      g.arc(0, 0, 62, 0, Math.PI * 2);
      g.fill();

      // Outer Military Olive Ring
      g.strokeStyle = '#5a7848';
      g.lineWidth = 3;
      g.stroke();

      // Tactical Crosshair Lines
      g.strokeStyle = 'rgba(90, 120, 72, 0.4)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(-60, 0); g.lineTo(-44, 0);
      g.moveTo(44, 0); g.lineTo(60, 0);
      g.moveTo(0, -60); g.lineTo(0, -44);
      g.moveTo(0, 44); g.lineTo(0, 60);
      g.stroke();

      // Shoulders / Camo BDU & Tactical Vest
      shape(g, '#445233', '#232b1a', 2, () => {
        g.moveTo(-50, 62);
        g.quadraticCurveTo(-38, 28, -24, 22);
        g.lineTo(24, 22);
        g.quadraticCurveTo(38, 28, 50, 62);
      });
      // Vest Collar & Straps
      shape(g, '#242820', '#121410', 1.8, () => {
        g.moveTo(-24, 24);
        g.lineTo(-12, 34);
        g.lineTo(12, 34);
        g.lineTo(24, 24);
        g.lineTo(26, 62);
        g.lineTo(-26, 62);
      });

      // Face / Jawline (Skin Tone)
      shape(g, '#c8926e', '#3b2416', 1.8, () => {
        g.moveTo(-18, 0);
        g.lineTo(18, 0);
        g.lineTo(14, 18);
        g.quadraticCurveTo(0, 26, -14, 18);
      });
      // Stubble / Shadow on jaw
      shape(g, 'rgba(40, 28, 20, 0.35)', null, 0, () => {
        g.moveTo(-14, 8);
        g.lineTo(14, 8);
        g.lineTo(12, 17);
        g.quadraticCurveTo(0, 24, -12, 17);
      });

      // Kevlar Combat Helmet (Olive Drab)
      shape(g, '#424f33', '#212918', 2, () => {
        g.arc(0, -8, 27, Math.PI, 0);
        g.lineTo(26, -4);
        g.lineTo(-26, -4);
      });
      // NVG Mount on Helmet
      shape(g, DARKSTEEL(g, -8, -24, 8, -16), '#0a0c0e', 1.2, () => {
        g.rect(-7, -24, 14, 10);
      });

      // Tactical Ballistic Visor / Goggles (Amber Tint)
      shape(g, '#e08a28', '#1a1810', 1.8, () => {
        g.moveTo(-20, -5);
        g.lineTo(-4, -6);
        g.lineTo(-4, 3);
        g.lineTo(-18, 2);
        g.closePath();
        g.moveTo(4, -6);
        g.lineTo(20, -5);
        g.lineTo(18, 2);
        g.lineTo(4, 3);
      });
      // Goggle Lens Glare
      shape(g, 'rgba(255, 255, 255, 0.45)', null, 0, () => {
        g.moveTo(-17, -3);
        g.lineTo(-12, -4);
        g.lineTo(-14, 1);
        g.lineTo(-18, 0);
      });

      // Headset on ear & Boom Mic
      shape(g, '#22252a', '#0c0d10', 1.5, () => {
        g.rect(-28, -6, 7, 16);
      });
      // Boom mic extending toward mouth
      g.strokeStyle = '#181b20';
      g.lineWidth = 2.5;
      g.beginPath();
      g.moveTo(-25, 6);
      g.quadraticCurveTo(-18, 14, -6, 12);
      g.stroke();
      shape(g, '#0c0d10', null, 0, () => {
        g.arc(-5, 12, 2.5, 0, Math.PI * 2);
      });
    }
  };

  Object.entries(builders).forEach(([id, fn]) => {
    const o = ictx();
    fn(o.g);
    ICON_URLS[id] = o.c.toDataURL();
  });
}

generateIcons();
