Coloque aqui as imagens de radar dos mapas, nomeadas pelo nome do mapa:

  de_dust2.png
  de_mirage.png
  de_inferno.png
  ...

O painel usa essas imagens como fundo do card de status e do radar 2D.
Sem imagem, o radar desenha uma grade procedural escura com o nome do mapa.

Calibração da projeção mundo->tela: crie um arquivo mapRegistry.json nesta
pasta (veja README.md na raiz do projeto) para sobrepor os defaults de
app/web/src/radar/mapRegistry.ts sem precisar recompilar o TypeScript.
