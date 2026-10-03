# Kage — jogo ninja 3D

Jogo de ação em terceira pessoa no navegador, feito com React, Vite e Three.js. Cenário, texturas e efeitos são gerados por código. O personagem jogável (O Rōnin) é um modelo rigado no Mixamo com animações de captura de movimento (`public/models/ronin.glb`), com combate em estilo Souls: cada golpe causa dano no frame de impacto do próprio clipe, combos só encadeiam dentro da janela de cada golpe e a esquiva só corta a recuperação. Os samurais inimigos alternam entre o Rōnin recolorido e um segundo modelo de samurai (ambos em versão leve, mesmos golpes e IA); o arqueiro inimigo tem modelo próprio com animações de arco longo (puxa, mira e solta, com corda dinâmica e flecha encaixada), chuta quem encosta e, a partir da onda 4, esquiva de golpes; o chefe é um gigante com a espada gigante e golpes do Rōnin transferidos para o esqueleto dele (golpe de cima, salto com golpe e varrida), com rugido de entrada; armas do jogador e dos inimigos são modelos 3D (`public/models/weapons/`). Controles sensíveis ao toque para celular e câmera automática.

## Rodando localmente

Pré-requisitos: Node.js 20.19+ ou 22.12+.

```bash
npm install
npm run dev
```

Abra `http://localhost:3000`.

## Build de produção

```bash
npm run build   # gera dist/
npm run preview # serve dist/ localmente para conferir
```

## Deploy no Netlify

O repositório já traz `netlify.toml` (comando de build, pasta publicada, versão do Node e cache). Basta conectar o repositório no Netlify — nenhuma variável de ambiente é necessária, o jogo não usa nenhuma chave de API.

## Deploy no GitHub Pages

O workflow `.github/workflows/pages.yml` gera o build e publica em `https://johnnybahia.github.io/ninja/` a cada push na `main`. Uma vez só: em *Settings → Pages → Build and deployment → Source*, escolha **GitHub Actions** (não "Deploy from a branch" — a raiz e `/docs` não servem, o jogo precisa ser compilado). O caminho base `/ninja/` é passado ao build pela variável `VITE_BASE`; sem ela (Netlify, `npm run dev`) o base é `/`.

## Progressão

- **Cartas de nível** (`src/game/cards.ts`): cada nível oferece 3 cartas, uma é mantida na partida. Todas têm nível máximo; o jogo pausa durante a escolha (teclas 1–3 no PC).
- **Honra 誉** (`src/game/meta.ts`): ganha por abate, finalização, onda limpa, nota da onda (D→S) e chefe. Vale mesmo ao morrer ou sair da partida e é gasta no **Templo da Honra** (menu e tela final) em 6 melhorias permanentes com teto (~+25% no total). Salva em `localStorage` (`kage_meta_v1`, versionado); se o navegador bloquear, o progresso fica só na sessão.
- **Nota da onda**: sem levar dano (2) + rapidez (1) + finalizações (1) + aparos (1) → S/A/B/C/D, com bônus de Honra.
- **Desafios de onda** (`src/game/mods.ts`): a partir da onda 3 (nunca nas ondas do chefe) metade das ondas muda o que os inimigos exigem: Névoa Densa, Chuva de Flechas, Ventania, Elites (mais vida/dano, soltam pergaminho) e Aço Temperado (postura difícil de quebrar). Limpar a onda rende Honra extra.
- **Chefe em 2 fases**: com metade da vida o Oni entra em Fúria — mais rápido, correntes maiores e uma onda de choque no chão depois das pancadas pesadas (pule ou esquive).
- **Cenários que mudam a cada 3 ondas** (`src/game/theme.ts`): Sakura (ondas 1–3), Outono (4–6), Inverno (7–9) e Brasas (10–12), e repete. O layout é o mesmo (colisões, props e IA não mudam); o tema muda a cor das copas, da grama, do chão e dos morros, tira as folhas das árvores no Inverno, esconde as flores e troca o que cai do céu (pétalas, folhas, neve, brasas). As folhas que saem de uma árvore cortada seguem o tema. A troca é gradual no início da onda; dá para desligar no menu ("Mudança de cenário") e fixar um tema com `?theme=0..3`.
- **Objetivos de onda** (`src/game/mods.ts`): a partir da onda 3 (fora das de chefe e das com desafio) a meta pode não ser matar todos: **Duelo** (um mestre samurai), **Resistir** (aguente até o amanhecer, com reforços a cada poucos segundos) ou **Capitão** (derrote o capitão de aura vermelha e o bando foge). Pagam Honra extra e contam como onda de desafio nas missões.
- **Samurais novos**: o **Brutamontes** (grande e lento, armadura que nenhum golpe leve abala, termina a sequência com uma varrida lenta para pular e fica cansado depois) e o **Monge de bastão** (ataca de longe com alcance maior). Entram no lugar de alguns samurais comuns a partir da onda 3; uma dica explica cada um na primeira vez.
- **O chefe muda de forma**: onda 4 o Oni, onda 8 o **Oni Trovão** (raios marcados no chão que caem depois de ~1 s: saia do círculo) e onda 12 o **Oni Sombrio** (some e reaparece de surpresa já preparando uma varrida para pular); depois repete mais forte.
- **Arena legível**: a onda não entra toda de uma vez. Só um número de inimigos fica em combate (até a onda 2: 2 samurais; da 3 à 5: 3; da 6 em diante: 4; no máximo 1–2 arqueiros; menos nas ondas do Oni; um a mais na caça ao capitão) e o resto espera na borda da arena, entrando de frente para a câmera 1,4 s depois de cada queda, com um tipo diferente dos que já estão lutando sempre que possível. A onda só termina quando a fila esvazia (o total e a pontuação não mudam); no Resistir há no máximo 5 em campo, e a queda do capitão limpa a fila. As barras de vida só aparecem para o Oni, quem está a menos de 9 m, atacando ou com a postura quebrada.
- **Modo Conquista** (`src/game/outposts.ts`; escolha "Conquista" na tela do Arsenal ou abra com `?mode=conquista`): em vez de ondas no meio da arena, o campo tem 3 postos inimigos (estandarte vermelho 将, paliçada, braseiros e um anel no chão; o minimapa e o aviso no alto mostram para onde ir). Chegar a ~20 m acorda a guarnição, que se forma dentro do anel; derrotar o **capitão** (um lutador nomeado, o brutamontes ou o Oni nos postos de chefe) quebra o bando e toma o posto, que cura 30% da vida e rende Honra. Cada posto tem uma guarnição de tipo diferente (infantaria, arqueiros ou guarda de elite) e conta como uma "onda" para a dificuldade, a nota e as missões; tomados os 3, os postos são retomados por reforços e a rodada seguinte vem mais forte. Usa a mesma fila de reforços da arena legível. Não conta para o ranking global.
- **Modo treino** (para ver o Oni e os cenários sem jogar até lá): `?wave=4` começa na onda 4 (Oni e cenário Outono), `?wave=8` no Oni Trovão, `?wave=12` no Oni Sombrio, `?wave=7` no Inverno, `?wave=10` nas Brasas; junte `&fury=1` para o Oni já entrar na Fúria (ondas de choque). Partida de treino não guarda Honra, missões nem recorde.
- **Lutadores nomeados** (modelos do Tripo/Mixamo em `assets_src/`, golpes do próprio Rōnin retargetados): a partir da onda 4 entram um por onda (dois a partir da 9), e também nos duelos. O **Samurai das Duas Espadas** (onda 4+) corta com as **espadas gêmeas da Dançarina** (fogo na direita, magia na esquerda) e fecha a sequência com um giro (pule). O **Shinobi** (onda 5+) é o mais veloz: espada com luz, **teletransporte** que o faz surgir perto de você já atacando, e leque de **estrelas** de arremesso à distância; a rasteira dele é para pular. O **Lutador do Raio** (onda 6+) luta **estilo Wolverine**, com **garras de lâmina nos dois punhos** cobertas de raios: sequências rápidas de golpes esquerda-direita, **teletransporte** com trovão, chute e giro final para pular. O **Samurai do Bō** (onda 3+) ataca de longe com o bastão e gira nele de vez em quando. Os modelos carregam em segundo plano ao começar a partida (`?wave=N` espera por eles).
- **Inimigos contornam obstáculos**: pedras, troncos, pilares e postes não prendem mais o Oni nem os samurais (desvio com lado fixo e detector de travamento).
- **Inimigos que reagem**: um golpe que conecta num samurai pode ser bloqueado (já existia, agora com aviso), aparado (o golpe quica, o combo quebra e ele contra-ataca rápido) ou esquivado (passo para trás/lado e volta). Quem está golpeando, tonto ou com a postura quebrada não defende; aparo e esquiva têm descanso (2,5 s por inimigo) e a chance sobe depois de 3 golpes seguidos sem defesa. Especiais atravessam a defesa. O chefe só bloqueia de vez em quando.
- **Flechas**: parte dos tiros antecipa o seu movimento, o dano cresce com a onda e, a partir da onda 4, o tiro vira rajada de 2 flechas (3 a partir da onda 8) — continuam só abalando, sem derrubar.
- **Ajuste ao vivo**: abra o jogo com `?tune=1` (engrenagem de ajustes) para mexer em chance de bloqueio/aparo/esquiva, vida e postura dos inimigos, dano e antecipação das flechas.
- **Golpes finais variados** (`FINISHERS` em `src/game/moves.ts`): 3 por arma, sorteadas a cada execução sem repetir a última da mesma arma (salto, estocada, corte deslizante, giro, arremesso, chute giratório, bomba com explosão…). Cada uma tem o instante do impacto medido no clipe, efeito próprio (poeira, sangue direcional, explosão) e a câmera acompanha.
- **Cenário que reage** (`src/game/props.ts`): lâminas, punhos e explosões (e as espadas inimigas) agora tocam o cenário. Aço em pedra solta faíscas e lascas; árvores soltam cascas, folhas/pétalas e galhinhos, ganham marcas de corte e a copa balança só na árvore atingida; o bambu corta e a ponta cai; lanternas de pedra aguentam golpes comuns, mas quebram com golpes pesados, especiais, bombas ou o Oni (sobra o toco e a luz apaga); mastros de bandeira e postes da varanda se partem e tombam. A pancada do Oni no chão estoura o que está em volta (lanternas, bambu, postes), lança terra e poeira, e a onda de choque da Fúria sacode as copas (chuva de folhas), derruba parte do bambu e os postes finos e abala as lanternas. Tudo usa pools fixos (escala com a qualidade gráfica) e volta ao normal ao reiniciar a partida.
- **Missões do dia** (`src/game/missions.ts`): 3 por dia (uma por dificuldade), sorteadas pela data local, com progresso acumulado e recompensa em Honra ao cumprir; sequência de dias com bônus crescente. Relógio voltado para trás não zera nada.
- **Ranking global** (`src/game/ranking.ts`, `scripts/ranking/`): ao entrar o jogador escolhe um nome (ou confirma "Você é X?" se já jogou neste navegador); o nome e um ID aleatório ficam em `localStorage` (`kage_player_v1`) e a melhor pontuação de cada ID vai para uma Planilha Google por um Web App do Apps Script, então o ranking é o mesmo para quem joga de qualquer lugar. A tela de morte é uma tabela de pontuação de fliperama (top 5 e a sua linha piscando, "NOVA POSIÇÃO #N!"/"NOVO CAMPEÃO!" e o texto piscando "TOQUE PARA JOGAR DE NOVO"), com a Honra ganha numa linha acima; o menu e o botão Ranking abrem o top 20. Partida de treino nunca envia. **Só aparece depois de colar a URL do Web App em `RANKING_URL`** (passo a passo em `scripts/ranking/README.md`); sem pontuação enviada por falta de conexão, ela fica pendente e sai na próxima vez.

## Estrutura

- `src/game/` — motor do jogo (Three.js puro): cenário (`world.ts`, `garden.ts`), personagens procedurais (`characters.ts`, `animation.ts`, `rigs.ts`), personagem com mocap (`clipRig.ts`), tabela de golpes com frames de impacto e janelas de combo (`moves.ts`), carregamento dos modelos (`models.ts`), combate e loop principal (`engine.ts`), pós-processamento (`postfx.ts`), texturas com relevo (`surfaces.ts`).
- `public/models/` — modelos que o jogo carrega: `ronin.glb` (personagem + malha leve dos inimigos + todos os clipes), `archer.glb`, `samurai2.glb` e `giant.glb` (inimigos) e `weapons/*.glb` (armas normalizadas: lâmina em +Z, fio em +Y, empunhadura na origem; as espadas gêmeas `dsfire`/`dsmagic` e as garras `claw_r`/`claw_l` carregam em segundo plano junto com os lutadores).
- `assets_src/` — arquivos originais enviados (FBX do Mixamo, pacotes de animação, GLBs das armas). Não vão para o deploy.
- `scripts/convert_characters.py`, `scripts/convert_weapons.py`, `scripts/optimize_models.mjs` — pipeline que gera `public/models/` a partir de `assets_src/` (veja abaixo).
- `src/App.tsx` — UI (menu, HUD, configurações) em React.
- `scripts/bake_textures.py` — gera as texturas procedurais em `public/tex/` (opcional, o resultado já fica versionado no repositório).
- `scripts/fetch_cc0_textures.py` — alternativa que baixa texturas CC0 do Poly Haven no lugar das procedurais.

## Pipeline de modelos 3D

Os arquivos em `public/models/` são gerados a partir de `assets_src/` — só é preciso rodar de novo ao trocar um modelo ou animação.

```bash
pip install bpy==5.0.1                 # Blender como módulo Python (Python 3.11)
python scripts/convert_characters.py ronin    # personagem + clipes (e retarget dos clipes de outros esqueletos)
python scripts/convert_characters.py archer   # arqueiro inimigo
python scripts/convert_characters.py samurai2 # segundo samurai (golpes do Rōnin via retarget)
python scripts/convert_characters.py giant    # chefe gigante (golpes do Rōnin via retarget)
python scripts/convert_weapons.py      # normaliza escala/eixo/empunhadura das armas
npm i --no-save @gltf-transform/core@4 @gltf-transform/extensions@4 @gltf-transform/functions@4 meshoptimizer@0.22
node scripts/optimize_models.mjs       # compressão meshopt -> public/models/
```

Para acrescentar um clipe do Mixamo, adicione-o na tabela `*_CLIPS` do personagem (mesmo esqueleto) ou em `*_RETARGET` (outro esqueleto com nomes Mixamo) no `convert_characters.py`, e defina o uso dele em `moves.ts`/`engine.ts`.
