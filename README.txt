DONE Bet mini app — bet.js (no on-chain swap)
===================================================

Script ini berisi:
- Connect wallet ke jaringan Base
- Menampilkan address + $DONE balance
- Bet ke kontrak DoneBtcPrediction
- BTC ticker + round timer
- Tombol "Swap $DONE on Uniswap" (membuka app.uniswap.org)
- Teks contract address $DONE yang bisa di-copy sekali klik

Cara pakai (ringkas)
--------------------
1. Simpan `bet.js` ini di project mini app kamu dan include di HTML,
   misalnya di halaman BET mini app:

   <!-- ethers v5 -->
   <script src="https://cdn.jsdelivr.net/npm/ethers@5.7.2/dist/ethers.umd.min.js"></script>

   <!-- script utama -->
   <script src="/path-ke/bet.js"></script>

2. Pastikan ID elemen berikut ada di HTML (kalau belum, tambahkan):

   Header & wallet:
     - wallet-addr-bet   : span untuk menampilkan address pendek (0xabc...1234)
     - network-name      : teks "Base"
     - network-pill      : pill kecil di pojok (opsional, cuma untuk warna)
     - done-balance      : span balance $DONE
     - btn-connect       : tombol connect / disconnect
     - wallet-hint       : teks kecil di bawah Wallet

   Bet section:
     - elemen dengan class "mode-chip" (Safe / Normal / Degen) dan atribut:
         data-side="0 atau 1", data-mult="1.2" dst.
     - bet-amount        : input teks jumlah DONE untuk bet
     - elemen dengan class "qa" untuk quick amount (10% / 25% / 50% / MAX)
         dan atribut data-perc="10" dst.
     - min-bet-hint      : span teks minimum bet
     - btn-place-bet     : tombol hijau Place bet
     - reward-preview    : teks penjelasan reward
     - payout-preview    : teks penjelasan payout
     - pool-info         : info pool DONE
     - bet-status        : status bawah (error / sukses)

   Ticker & round:
     - btc-price         : harga BTC sekarang
     - btc-change        : % perubahan
     - round-timer       : hitung mundur detik
     - btn-up            : tombol pilih "up"
     - btn-down          : tombol pilih "down"

   Tombol Uniswap & CA:
     - btn-open-swap     : tombol besar di bawah Place bet.
                           Script akan mengubah label menjadi
                           "Swap $DONE on Uniswap" dan ketika diklik
                           membuka:
                           https://app.uniswap.org/swap?chain=base&outputCurrency=0x3Da0Da9414D02c1E4cc4526a5a24F5eeEbfCEAd4
     - done-ca-copy      : span/div teks contract address $DONE.
                           Script akan mengisi alamat tersebut dan
                           ketika di-klik akan menyalin CA ke clipboard
                           (show "Copied!" sebentar).

3. Kontrak yang digunakan
   - Token DONE  : 0x3Da0Da9414D02c1E4cc4526a5a24F5eeEbfCEAd4
   - Bet contract: 0xC107CDB70bC93912Aa6765C3a66Dd88cEE1aCDf0

Tidak ada logika swap on-chain di dalam bet.js ini.
Semua swap dilakukan di dApp Uniswap langsung melalui tombol eksternal.
