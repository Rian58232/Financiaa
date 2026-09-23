# Meu Controle Financeiro

Site pessoal, mobile-first, para controlar entradas, saídas, Pix, dinheiro, cartões simplificados, contas e faturas.

## Rodar

Abra `index.html` por um servidor local ou publique os arquivos no GitHub Pages.

## Cartões

O cadastro pede somente:
- nome/apelido;
- limite opcional;
- dia de fechamento;
- dia de vencimento.

Nenhum número real de cartão, CVV, agência ou dado bancário é usado.

O limite considera como comprometidas as compras/faturas do cartão que ainda não foram marcadas como pagas. Parcelas futuras também entram no valor comprometido.

## Notificações

O sino no topo mostra avisos de:
- contas vencidas;
- contas vencendo em até 3 dias;
- faturas vencidas;
- faturas vencendo em até 3 dias;
- cartão a partir de 80% do limite.

As notificações do navegador são opcionais. Em HTTPS (como GitHub Pages) ou localhost, o usuário pode conceder permissão. Esta versão dispara avisos quando o site está carregado/visitado. Notificação push com o site completamente fechado exige um serviço de push/backend.

## IMPORTANTE — GitHub Pages não sincroniza dados sozinho

Os dados desta versão ficam em `localStorage`. Publicar no GitHub Pages hospeda o site, mas cada celular/computador terá seu próprio armazenamento.

Para duas ou mais pessoas verem os mesmos dados em tempo real, conecte o site a um banco na nuvem. Uma opção simples é Supabase (banco + login + realtime). O ideal é criar uma carteira compartilhada para que cada pessoa tenha seu próprio login, mas ambas vejam o mesmo conjunto de dados.

Não publique chaves secretas de backend no GitHub. Chaves públicas/anon de serviços como Supabase só devem ser usadas junto com regras de segurança (RLS) corretamente configuradas.
