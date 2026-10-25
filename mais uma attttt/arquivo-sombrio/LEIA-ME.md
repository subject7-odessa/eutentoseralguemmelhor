# Arquivo Sombrio

Site de mesa de RPG com contas, fichas, combate, tabuleiro virtual e livro de regras. Funciona com dois sistemas:
**Supernatural** (investigação sobrenatural) e **Cyberpunk RED**. Quem cria a campanha escolhe o sistema.

## O que tem na pasta

| Pasta | Para que serve | Vai para o site? |
|---|---|---|
| `site/` | Os arquivos do site: `index.html`, `catalogo.js`, `livro.js`, `red.js`, `tabuleiro.js`, mais `manifest.webmanifest`, `sw.js` e os `icon-*.png` (instalação no celular) | **Sim, todos juntos na mesma pasta** |
| `sql/` | Os comandos para o banco (Supabase), numerados na ordem de uso | Não (só colar no Supabase) |
| `privado/mestre.json` | Capítulos do livro só para o mestre (Cap. 17 a 41, apêndices B e E) | **NUNCA publique este arquivo** |
| `tests/` | Testes automáticos (opcional) | Não |

## Instalação do zero

1. **Supabase.** Em supabase.com crie uma conta e um projeto (plano gratuito basta).
2. **Banco.** No menu **SQL Editor → New query**, cole e rode (**Run**) cada arquivo de `sql/` **nesta ordem**, um de cada vez:
   `01_schema` → `02_sessao` → `03_passar_turno` → `04_tabuleiro` → `05_red` → `06_conteudo` → `07_tabuleiro_v2` → `08_tabuleiro_v3` → `09_tabuleiro_v4`.
   Todos podem ser rodados de novo sem estragar nada. O arquivo que começa com `00_` é só para projetos muito antigos; ignore.
3. **Chaves.** Em **Project Settings → API** copie a **Project URL** e a chave **anon public**. Abra `site/index.html` num editor de texto e cole nas linhas `SUPABASE_URL` e `SUPABASE_KEY`, no topo do script. A chave anon é pública por desenho; quem protege os dados são as regras dos arquivos `.sql`.
4. **Login.** Em **Authentication → Providers → Email**: para testar rápido, desligue "Confirm email".
5. **Publicar (grátis).** Arraste a pasta `site/` em netlify.com/drop (ou use Vercel/GitHub Pages). Depois, em **Authentication → URL Configuration**, coloque o endereço do site em **Site URL**.
6. **Conteúdo do mestre (uma vez só).** Entre no site com a conta de mestre, abra a aba **Livro** e use **Importar conteúdo do mestre**, escolhendo `privado/mestre.json`. Ele fica salvo na sua conta e só você lê, em qualquer campanha em que você seja o mestre.

### Se você já tinha o site funcionando
Basta rodar `06_conteudo.sql`, `07_tabuleiro_v2.sql`, `08_tabuleiro_v3.sql` e `09_tabuleiro_v4.sql`, trocar os arquivos de `site/` (mantendo as suas duas chaves no `index.html`) e fazer o passo 6.

## Instalar no celular (como aplicativo)

Com o site publicado (endereço `https://`), abra-o no celular:
- **Android (Chrome):** menu ⋮ → **Instalar app** (ou **Adicionar à tela inicial**).
- **iPhone (Safari):** botão de compartilhar → **Adicionar à Tela de Início**.
Ele passa a abrir em tela cheia, com ícone próprio, e carrega mais rápido. Se o sinal cair, a tela continua abrindo (os dados da mesa precisam de internet). Quando você publicar uma versão nova, o aplicativo atualiza sozinho na próxima abertura com internet.

## Como jogar

- O mestre cria a campanha (escolhendo **Supernatural** ou **Cyberpunk RED**) e passa o **código de 6 letras** (aba Mesa) aos jogadores.
- Cada jogador cria a conta, entra com o código e cria a própria ficha. Jogador edita só a própria ficha; o mestre edita todas.
- Cada rolagem aparece para todos e fica no **Log de dados**.
- **Mesa:** combate com iniciativa e turnos (o jogador passa o próprio turno), pistas e notas reveladas pelo mestre.
- **Tabuleiro:** cenas com mapa, grade, tokens ligados às fichas e ao combate, régua (com metros por casa), desenho (lápis, linha, retângulo, círculo, Ctrl+Z), névoa de guerra com visão dos personagens, token no formato da imagem e **cor da borda** de cada token e **modelos de token** (salve tokens genéricos, ameaças e personagens com várias versões: por exemplo "Lobisomem: forma humana / forma de lobo", e reutilize depois). O jogador move só os próprios tokens.
- **Livro (Supernatural):** regras do livro, busca em todo o texto, tabelas d20, gerador de nomes e, para o mestre, o **Construtor de criatura**. A busca rápida (**Ctrl K**) também procura no livro.
- **Cyberpunk RED:** assistente de criação (Streetrat, Edgerunner, Complete Package), ficha completa, Netrunning, cyberware, NPCs e a Biblioteca com regras, armas, equipamento, veículos e medicina.
- **Backup:** botões **Backup (JSON)**, **Importar backup** e **PDF das fichas** na lista de personagens (nos dois sistemas).

## O que é privado e o que não é

- **Protegido de verdade:** os capítulos do mestre (Cap. 17 a 41 e apêndices B e E), que ficam no banco e só o dono da conta lê.
- **Não protegido (ficam em arquivos públicos do site):** o bestiário e o catálogo (`catalogo.js`), as tabelas d20 e os nomes (`livro.js`) e os NPCs do Cyberpunk RED (`red.js`). Quem souber o endereço do arquivo consegue ler. A névoa de guerra também é só visual: quem abrir o arquivo do mapa vê a imagem inteira.
- Só publique `site/`. Nunca publique `privado/`.

## Testes (opcional)

Precisa de Python: `pip install playwright` e `playwright install chromium`. Depois, na pasta `tests/`: `python run_all.py`.
Há também um teste que confere se nenhuma tela do site estoura a largura de um celular. Os testes usam um banco de mentira (`mock_supabase.js`), então só garantem que as telas funcionam sem erros; eles **não** testam as regras de segurança do Supabase.
