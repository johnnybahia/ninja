// --- Adicione estas propriedades à sua classe Engine ou objeto Player ---
class GameEngine {
    timeScale = 1.0;
    hitStopTimer = 0;
    ghosts: any[] = [];
    camTarget = new THREE.Vector3();
    
    // ... no construtor ou init do player ...
    player = {
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        yaw: 0,
        moveAmt: 0,
        dashTimer: 0,
        dashCooldown: 0,
        isDashing: false,
        isAttacking: false,
        attackTimer: 0,
        comboStep: 0,
        isParrying: false,
        parryTimer: 0,
        justLanded: false
    };

    update(dt: number) {
        // 1. GESTÃO DE TEMPO (Slow Motion e Hit-stop)
        if (this.hitStopTimer > 0) {
            this.hitStopTimer -= dt;
            return; // Pausa o frame para dar impacto
        }
        this.timeScale = THREE.MathUtils.lerp(this.timeScale, 1.0, dt * 5);
        const adt = dt * this.timeScale; // Delta Time Ajustado

        this.updatePlayerMovementAndCamera(dt, adt);
        this.updateCombatLogic(adt);
        this.updateGhosts(dt);
    }

    updatePlayerMovementAndCamera(dt: number, adt: number) {
        const p = this.player;
        const input = this.input;

        // Movimento relativo à câmera
        const camEuler = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
        const forward = new THREE.Vector3(0,0,-1).applyEuler(new THREE.Euler(0, camEuler.y, 0));
        const right = new THREE.Vector3(1,0,0).applyEuler(new THREE.Euler(0, camEuler.y, 0));
        const moveDir = new THREE.Vector3().addScaledVector(right, input.axisX).addScaledVector(forward, input.axisZ);

        // DASH LOGIC
        if (input.shift && p.dashCooldown <= 0 && !p.isDashing) {
            p.isDashing = true;
            p.dashTimer = 0.25;
            p.dashCooldown = 0.6;
            this.spawnGhost(p);
        }
        if (p.dashCooldown > 0) p.dashCooldown -= adt;

        if (p.isDashing) {
            p.dashTimer -= adt;
            const dashSpeed = 22;
            p.vel.x = Math.sin(p.yaw) * dashSpeed;
            p.vel.z = Math.cos(p.yaw) * dashSpeed;
            if (p.dashTimer <= 0) p.isDashing = false;
        } else {
            // MOVIMENTO COM INÉRCIA
            const ACCEL = 40;
            const FRICTION = 12;
            const MAX_SPEED = 7.5;

            if (moveDir.length() > 0.1) {
                p.vel.x = THREE.MathUtils.lerp(p.vel.x, moveDir.x * MAX_SPEED, adt * 8);
                p.vel.z = THREE.MathUtils.lerp(p.vel.z, moveDir.z * MAX_SPEED, adt * 8);
                p.yaw = turnTo(p.yaw, Math.atan2(p.vel.x, p.vel.z), adt * 15);
            } else {
                p.vel.x = THREE.MathUtils.lerp(p.vel.x, 0, adt * FRICTION);
                p.vel.z = THREE.MathUtils.lerp(p.vel.z, 0, adt * FRICTION);
            }
        }

        p.pos.addScaledVector(p.vel, adt);
        p.moveAmt = THREE.MathUtils.lerp(p.moveAmt, p.vel.length() / 7.5, adt * 10);

        // CÂMERA PREDITIVA (Leading)
        const leadX = p.vel.x * 0.2;
        const leadZ = p.vel.z * 0.2;
        this.camTarget.lerp(new THREE.Vector3(p.pos.x + leadX, p.pos.y + 1.5, p.pos.z + leadZ), dt * 6);
        // ... lógica de órbita da câmera usando this.camTarget ...
    }

    updateCombatLogic(adt: number) {
        const p = this.player;
        if (this.input.clickLeft && !p.isAttacking) {
            p.isAttacking = true;
            p.attackTimer = 0.45;
            p.comboStep = (p.comboStep + 1) % 3;
            // Hit-stop teste ao atacar
            this.hitStopTimer = 0.02; 
        }
        if (p.attackTimer > 0) p.attackTimer -= adt;
        else p.isAttacking = false;

        if (this.input.clickRight) {
            p.isParrying = true;
            p.parryTimer = 0.3;
        }
        if (p.parryTimer > 0) p.parryTimer -= adt;
        else p.isParrying = false;
    }

    spawnGhost(p: any) {
        this.ghosts.push({ pos: p.pos.clone(), yaw: p.yaw, opacity: 0.6, life: 0.4, config: {...p.animConfig} });
    }

    updateGhosts(dt: number) {
        this.ghosts.forEach((g, i) => {
            g.life -= dt;
            g.opacity -= dt * 1.5;
            if (g.life <= 0) this.ghosts.splice(i, 1);
        });
    }
}
