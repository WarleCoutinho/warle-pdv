# Assistente cartoon — conjunto v1

Artes PNG geradas com a ferramenta integrada `image_gen`, a partir da ilustração aprovada pelo usuário. Transparência alpha preservada. As poses neutra, fala, piscada e apontamento são utilizadas pelo assistente no PDV; a saudação permanece disponível para uma etapa posterior.

| Arquivo | Uso |
| --- | --- |
| point-left.png | Ilustração original aprovada, apontando para cima à esquerda |
| point-right.png | Apontando para cima à direita |
| neutral.png | Repouso, boca fechada |
| speaking.png | Boca aberta, base para simular fala |
| blink.png | Olhos fechados, base para piscada |
| greeting.png | Mão levantada em saudação |

Abra `preview.html` para ver as poses e uma prévia por troca de quadros, sem áudio. Ela não modifica o PDV.

## Direção dos prompts

Referência fixa: humano cartoon 2D da cintura para cima, pele quente, cabelo escuro simplificado, olhos grandes, polo verde, contornos grossos verde-escuros, formas arredondadas e fundo transparente. Sem texto, balão ou interface na arte.

- Neutral: preservar identidade; rosto frontal, sorriso de boca fechada, mãos relaxadas junto à cintura.
- Speaking: editar a base neutra; alterar somente a boca para um pequeno sorriso aberto com dentes superiores e língua, preservando composição e pose.
- Blink: editar a base neutra; alterar somente os olhos para pálpebras fechadas curvas, preservando sorriso e pose.
- Point right: usar a ilustração aprovada como referência; apontar o indicador para cima à direita, outra mão aberta, mesma identidade e enquadramento.
- Greeting: usar a base neutra como referência; levantar a mão à esquerda do observador, palma aberta em saudação, outra mão na cintura.

## Limites da animação

São poses e quadros gerados individualmente, não um personagem com rig ou partes separadas. Há pequenas diferenças entre os desenhos e dimensões de 1354–1355 por 1160–1161 pixels. A prévia permite avaliar essas diferenças; a integração final deve alinhar os quadros e conferir a estabilidade visual. A alternância da boca simula fala, sem sincronização com áudio. A saudação é uma pose estática, ainda sem quadros intermediários de movimento.
