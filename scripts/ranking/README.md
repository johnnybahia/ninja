# Ranking do Kage (Google Apps Script)

O ranking é global: qualquer pessoa que jogue em qualquer lugar grava e lê a mesma planilha. O jogo fala com um Web App do Apps Script; nenhum segredo fica no site.

## Instalar (uma vez, ~5 min)

1. Crie uma **Planilha Google** nova (ex.: "Kage Ranking").
2. Menu **Extensões → Apps Script**. Apague o conteúdo e cole todo o `Code.gs` desta pasta. Salve.
3. **Implantar → Nova implantação → Tipo: App da Web**
   - Executar como: **Eu**
   - Quem tem acesso: **Qualquer pessoa**
4. Autorize quando o Google pedir e copie a **URL do app da Web** (termina em `/exec`).
5. Cole a URL em `RANKING_URL`, no topo de `src/game/ranking.ts`, e publique o jogo. Enquanto `RANKING_URL` estiver vazia, o jogo não mostra nada de ranking.

A aba `ranking` é criada sozinha na primeira chamada. Para limpar o ranking, apague as linhas abaixo do cabeçalho.

## Ao mudar o `Code.gs`

Edite → **Implantar → Gerenciar implantações → ícone de lápis → Versão: Nova versão → Implantar**. A URL continua a mesma.

## Como funciona

- Cada navegador guarda um **ID aleatório** e o nome no `localStorage`. O ID é a identidade: o ranking mantém a **maior** pontuação por ID.
- Nome único (sem diferenciar maiúsculas, acentos e pontuação), 2 a 16 caracteres, com filtro básico de palavrões.
- O servidor recusa pontuação acima de um teto por onda (`MAX_SCORE_PER_WAVE`), limita envios a um a cada 4 s por ID e usa trava para não perder gravações simultâneas.
- A lista do top 50 fica em cache por 30 s.

## Limites

- Quem limpa os dados do navegador ou troca de aparelho vira outro jogador (não há senha).
- Não existe proteção total contra pontuação falsa: o teto por onda só barra valores absurdos.
- Cota do Apps Script: dezenas de milhares de chamadas por dia na conta gratuita, muito acima do necessário aqui.
