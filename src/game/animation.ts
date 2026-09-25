// --- Substitua ou atualize sua função principal de animação ---

export function updateAnimation(p: any, dt: number) {
    // Reset de joints
    clearJoints(); 
    let hipsY = 0;

    const m = p.moveAmt;
    const ph = Date.now() * 0.012; // Fase da corrida
    
    // 1. LOCOMOÇÃO PROFISSIONAL (Leaning & Weight)
    if (!p.isDashing && !p.isAttacking) {
        const run = smooth((m - 0.45) / 0.5);
        const s = Math.sin(ph);
        const co = Math.cos(ph);

        // Inclinação lateral baseada na curva (Side Lean)
        const sideLean = -p.vel.x * Math.cos(p.yaw) + p.vel.z * Math.sin(p.yaw);
        
        add('spine', 0.2 * m + run * 0.1, 0, sideLean * 0.12);
        add('chest', 0.1 * m, s * 0.05 * m, sideLean * 0.05);

        // Pernas
        const legA = (0.6 + 0.3 * run) * m;
        add('legL', -s * legA);
        add('legR', s * legA);
        add('shinL', Math.max(0, co) * 0.8 * m);
        add('shinR', Math.max(0, -co) * 0.8 * m);

        hipsY = m * 0.08 * (Math.abs(co) - 0.5);
    }

    // 2. DASH POSE (Low Profile)
    if (p.isDashing) {
        hipsY = -0.4;
        add('spine', 0.8); 
        add('armL', -1.2, 0, -0.3);
        add('armR', -1.2, 0, 0.3);
        add('legL', 0.8); add('legR', -0.5);
    }

    // 3. COMBAT POSES
    if (p.isAttacking) {
        const t = 1.0 - (p.attackTimer / 0.45);
        if (p.comboStep === 1) { // Corte Horizontal
            add('spine', 0.2, t * 2.5, 0);
            add('armR', 1.2, -1.5 + t * 3.5, 0.6);
        } else { // Corte Vertical
            add('spine', 0.6 * Math.sin(t * Math.PI));
            add('armR', 1.8 - t * 3, 0, 0);
        }
    }

    if (p.isParrying) {
        add('armR', 1.5, -0.8, 0.6);
        add('armL', 1.4, 0.8, -0.6);
        hipsY -= 0.1;
    }

    // 4. LANDING JUICE
    if (p.justLanded) {
        hipsY -= 0.3;
    }

    // Aplica o Hips Final
    applyHips(hipsY);
}
