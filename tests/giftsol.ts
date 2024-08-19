import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Giftsol } from "../target/types/giftsol";
import { expect } from "chai";

describe("giftsol", () => {
  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Giftsol as Program<Giftsol>;

  it("Create a gift card", async () => {
    // Generate a new keypair for the gift card
    const seed = new anchor.BN(Date.now());
    const couponCode = "TEST_COUPON";
    const amount = new anchor.BN(1000000); // 1 SOL (adjust for decimals)
    const hashedCouponCode = customHash(couponCode);

    // Derive the PDA for the gift card account
    const [giftCardPda, _bump] = await anchor.web3.PublicKey.findProgramAddress(
      [
        Buffer.from("giftcard"),
        provider.wallet.publicKey.toBuffer(),
        seed.toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );

    // Execute the transaction to create a gift card
    await program.methods
      .createGiftcard(seed, couponCode, amount)
      .accountsPartial({
        giftcard: giftCardPda,
        creator: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    // Fetch the created gift card account
    const giftCardAccount = await program.account.giftCard.fetch(giftCardPda);

    // Validate the gift card account data
    expect(giftCardAccount.seed.toNumber()).to.equal(seed.toNumber());
    expect(giftCardAccount.creator.toBase58()).to.equal(
      provider.wallet.publicKey.toBase58()
    );
    expect((giftCardAccount.hashedCouponCode.toString())).to.deep.equal(hashedCouponCode.toString());

    expect(giftCardAccount.amount.toNumber()).to.equal(amount.toNumber());
  });

  // it("Redeem a gift card", async () => {
  //   const couponCode = "TEST_COUPON";
  //   const hashedCouponCode = customHash(couponCode);
  //   const seed = new anchor.BN(Date.now());
  //   // Derive the PDA for the gift card account
  //   const [giftCardPda, bump] = await anchor.web3.PublicKey.findProgramAddress(
  //     [
  //       Buffer.from("giftcard"),
  //       provider.wallet.publicKey.toBuffer(),
  //       seed.toArrayLike(Buffer, "le", 8),
  //     ],
  //     program.programId
  //   );

  //   // Execute the transaction to redeem the gift card
  //   await program.methods
  //     .avail(couponCode)
  //     .accountsPartial({
  //       giftcard: giftCardPda,
  //       claimer: provider.wallet.publicKey,
  //       systemProgram: anchor.web3.SystemProgram.programId,
  //     })
  //     .rpc();

  //   // Attempt to fetch the gift card account again, expecting it to be closed
  //   try {
  //     await program.account.giftCard.fetch(giftCardPda);
  //     throw new Error("Gift card was not closed after redemption");
  //   } catch (error) {
  //     expect(error.toString()).to.include("Account does not exist");
  //   }
  // });

  // Helper function to mimic the custom hashing in the smart contract
  function customHash(input: string): Uint8Array {
    const output = new Uint8Array(32);
    const inputBytes = Buffer.from(input);

    inputBytes.forEach((byte, i) => {
      output[i % 32] ^= byte;
    });

    return output;
  }
});
