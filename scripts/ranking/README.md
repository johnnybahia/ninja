# Ranking do Kage (Google Apps Script)

O ranking é global: qualquer pessoa que jogue em qualquer lugar grava e lê a mesma planilha. O jogo fala com um Web App do Apps Script; nenhum segredo fica no site.

## Instalar (uma vez, ~5 min, dá para fazer no celular)

O script funciona como **projeto avulso**: na primeira chamada ele cria sozinho a planilha "Kage Ranking" no seu Drive. Não precisa criar planilha nem abrir o menu Extensões.

No celular, abra os passos abaixo no navegador com **"Site para computador"** ligado (Chrome Android: menu ⋮; Safari iPhone: "aA" → "Solicitar site para computador"). O app do Planilhas e o do Drive não criam scripts.

1. Abra <https://script.google.com> e crie um **Novo projeto**.
2. Apague o conteúdo do editor e cole todo o `Code.gs` desta pasta (no GitHub: abra o arquivo, toque em **Raw**, selecione tudo e copie). Salve.
3. **Implantar → Nova implantação → Tipo: App da Web**
   - Executar como: **Eu**
   - Quem tem acesso: **Qualquer pessoa**
4. Autorize quando o Google pedir (ele avisa que o app não foi verificado: **Avançado → Acessar (não seguro)**; o código é o seu) e copie a **URL do app da Web** (termina em `/exec`).
5. Cole a URL em `RANKING_URL`, no topo de `src/game/ranking.ts`, e publique o jogo. Enquanto `RANKING_URL` estiver vazia, o jogo não mostra nada de ranking.

A planilha "Kage Ranking" (aba `ranking`) aparece no seu Drive depois do primeiro acesso. Para limpar o ranking, apague as linhas abaixo do cabeçalho. Se preferir criá-la antes, rode a função `setup` no editor: o endereço da planilha sai no registro de execução.

Também funciona colado dentro de uma planilha existente (Extensões → Apps Script): nesse caso usa essa planilha.

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
