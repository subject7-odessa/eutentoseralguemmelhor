# Arquivo Sombrio — site com contas e banco (Supabase)

## 1. Criar o projeto
1. Entre em supabase.com e crie uma conta (plano gratuito basta).
2. **New project** → escolha nome, senha do banco e região (South America, se aparecer).

## 2. Criar as tabelas
1. Menu **SQL Editor** → **New query**.
2. Cole todo o conteúdo de `schema.sql` e clique em **Run**.
3. Deve aparecer "Success". Rode só uma vez.

## 3. Ligar o site ao projeto
1. **Project Settings → API**: copie a **Project URL** e a chave **anon public**.
2. Abra `index.html` num editor de texto e cole os dois valores nas linhas `SUPABASE_URL` e `SUPABASE_KEY`, no topo do script.
   A chave anon é pública por desenho; quem protege os dados são as regras do `schema.sql`.

## 4. Login por e-mail
Em **Authentication → Providers → Email**: para testar rápido, desligue "Confirm email". Se deixar ligado, cada jogador precisa clicar no e-mail de confirmação ao se cadastrar.

## 5. Colocar no ar (grátis)
Arraste a pasta com o `index.html` em netlify.com/drop, ou use Vercel ou GitHub Pages.
Depois, em **Authentication → URL Configuration**, coloque o endereço do site em **Site URL**.

## Como jogar
- O mestre cria a campanha e passa o **código de 6 letras** (aba Mesa) aos jogadores.
- Cada jogador cria a conta, entra com o código e cria a própria ficha.
- Jogador edita só a própria ficha; o mestre edita todas. Os outros veem em modo leitura.
- A aba **Ameaças** só aparece para o mestre.
- Cada rolagem aparece no canto inferior direito de todos e fica no **Log de dados**.
- ⚔ na arma rola ataque e, se acertar, o dano: `ataque=20 / dano=8`. 🎲 ao lado rola só o dano.
- Em cada atributo, o campo **adicional** soma ao valor base (para quem passou do limite humano).

## Atualização (criação de personagem, abas da ficha, catálogo de ameaças)
- Projeto novo: rode só o `schema.sql`.
- Projeto que já tinha rodado o schema antigo: rode apenas `schema_v2_atualizacao.sql` (não apaga nada) e troque o `index.html` (mantendo suas duas chaves).
- "Novo agente" abre o assistente de 4 etapas baseado no Cap. 2 do livro: Atributos (15 pontos, máx. 4) → Origem (20 especialidades, treinamento profissional, recursos) → Perícias (50 pontos, máx. 30 por perícia) → Toques Finais.
