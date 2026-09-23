# Meu Controle Financeiro — sincronização instantânea

Versão preparada para uso em dois celulares com a mesma conta Supabase.

## O que mudou nesta versão

- Toda ação local é **otimista e imediata**: adicionar, excluir, pagar fatura, pagar conta, criar cartão etc. atualiza a tela na mesma hora, sem reload.
- A gravação no Supabase acontece em segundo plano.
- Os outros aparelhos recebem um sinal por **Supabase Realtime Broadcast** e puxam o estado novo automaticamente.
- Existe um fallback de sincronização periódica caso o canal Realtime caia.
- Foi corrigida uma condição de corrida: uma segunda alteração feita enquanto a primeira ainda estava sendo salva não é mais marcada por engano como sincronizada.
- Abas abertas no mesmo navegador também se atualizam por `BroadcastChannel`.
- O cache do PWA foi versionado para evitar ficar preso numa versão antiga do JavaScript.

## Publicar

Suba todos os arquivos desta pasta para a raiz do repositório usado no GitHub Pages.

Não é necessário rodar SQL extra para o mecanismo principal de atualização ao vivo desta versão: ele usa Broadcast do Supabase para avisar os outros aparelhos e o RLS da tabela `app_state` continua protegendo a leitura/escrita.

Os dois celulares devem entrar com a mesma conta do app para compartilhar o mesmo estado financeiro.
