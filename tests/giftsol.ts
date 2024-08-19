import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Giftsol } from "../target/types/giftsol";
import { expect } from "chai";

describe("giftsol", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Giftsol as Program<Giftsol>;

  let admin = provider.wallet.publicKey;
  let feeReceiver = anchor.web3.Keypair.generate();
  let seed: anchor.BN;
  let couponCode = "TEST_COUPON";
  let amount = new anchor.BN(100 * anchor.web3.LAMPORTS_PER_SOL); // 1 SOL (adjust for decimals)
  let feePercentage = 2; // 2% fee
  let giftCardPda: anchor.web3.PublicKey;
  
  before(async () => {
    await provider.connection.requestAirdrop(
      feeReceiver.publicKey,
      anchor.web3.LAMPORTS_PER_SOL
    );
    await program.methods
      .initialize()
      .accountsPartial({
        globalState: await getGlobalStatePda(),
        admin,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    await program.methods
      .updateFeeSettings(feePercentage, feeReceiver.publicKey)
      .accountsPartial({
        globalState: await getGlobalStatePda(),
        admin,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();
  });

  it("Create a gift card and check fee deduction", async () => {
    seed = new anchor.BN(Date.now());
    const hashedCouponCode = customHash(couponCode);

    [giftCardPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("giftcard"),
        provider.wallet.publicKey.toBuffer(),
        seed.toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );

    const initialFeeReceiverBalance = await getAccountBalance(
      feeReceiver.publicKey
    );
    const initialCreatorBalance = await getAccountBalance(admin);
    await program.methods
      .createGiftcard(seed, couponCode, amount)
      .accountsPartial({
        giftcard: giftCardPda,
        creator: provider.wallet.publicKey,
        feeReceiver: feeReceiver.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const finalFeeReceiverBalance = await getAccountBalance(
      feeReceiver.publicKey
    );
    const finalCreatorBalance = await getAccountBalance(admin);

    const expectedFee = amount.muln(feePercentage).divn(100);
    const expectedGiftCardAmount = amount.sub(expectedFee);

    expect(
      initialCreatorBalance.sub(finalCreatorBalance).eq(amount.add(
        //rent + transaction fee
        new anchor.BN(
          await provider.connection.getMinimumBalanceForRentExemption(89)
        ).addn(5000)
      ))
    ).to.be.true;

    expect(
      finalFeeReceiverBalance.sub(initialFeeReceiverBalance).eq(expectedFee)
    ).to.be.true;

    const giftCardAccount = await program.account.giftCard.fetch(giftCardPda);
    expect(giftCardAccount.seed.toNumber()).to.equal(seed.toNumber());
    expect(giftCardAccount.creator.toBase58()).to.equal(
      provider.wallet.publicKey.toBase58()
    );
    expect(giftCardAccount.hashedCouponCode.toString()).to.deep.equal(
      hashedCouponCode.toString()
    );
    expect(giftCardAccount.amount.toNumber()).to.equal(
      expectedGiftCardAmount.add(expectedFee).toNumber()
    );
  });

  it("Avail a gift card", async () => {
    const expectedFee = amount.muln(feePercentage).divn(100);
    const expectedClaimAmount = amount.sub(expectedFee);

    const initialClaimerBalance = await getAccountBalance(
      provider.wallet.publicKey
    );

    await program.methods
      .avail(couponCode)
      .accountsPartial({
        giftcard: giftCardPda,
        claimer: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const finalClaimerBalance = await getAccountBalance(
      provider.wallet.publicKey
    );
    const claimerBalanceChange = finalClaimerBalance.sub(initialClaimerBalance);

    expect(
      claimerBalanceChange.eq(
        expectedClaimAmount.add(
          new anchor.BN(
            await provider.connection.getMinimumBalanceForRentExemption(89)
          ).subn(4960)
        )
      )
    ).to.be.true;

    try {
      await program.account.giftCard.fetch(giftCardPda);
      throw new Error("Gift card should be closed after availing");
    } catch (err) {
      expect(err.message).to.include("Account does not exist");
    }
  });

  it("Update fee settings", async () => {
    const newFeePercentage = 10;
    const newFeeReceiver = anchor.web3.Keypair.generate().publicKey;

    await program.methods
      .updateFeeSettings(newFeePercentage, newFeeReceiver)
      .accountsPartial({
        globalState: await getGlobalStatePda(),
        admin,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const globalState = await program.account.globalState.fetch(
      await getGlobalStatePda()
    );

    expect(globalState.feePercentage).to.equal(newFeePercentage);
    expect(globalState.feeReceiver.toBase58()).to.equal(
      newFeeReceiver.toBase58()
    );
  });

  it("Unauthorized update fee settings should fail", async () => {
    const maliciousUser = anchor.web3.Keypair.generate();
    const newFeePercentage = 15;

    try {
      await program.methods
        .updateFeeSettings(newFeePercentage, feeReceiver.publicKey)
        .accountsPartial({
          globalState: await getGlobalStatePda(),
          admin: maliciousUser.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([maliciousUser])
        .rpc();
      throw new Error("Unauthorized update should have failed");
    } catch (err) {
      expect(err.message).to.include("Unauthorized");
    }
  });

  function customHash(input: string): Uint8Array {
    const output = new Uint8Array(32);
    const inputBytes = Buffer.from(input);

    inputBytes.forEach((byte, i) => {
      output[i % 32] ^= byte;
    });

    return output;
  }

  async function getGlobalStatePda(): Promise<anchor.web3.PublicKey> {
    const [globalStatePda] = await anchor.web3.PublicKey.findProgramAddress(
      [Buffer.from("global_state")],
      program.programId
    );
    return globalStatePda;
  }

  async function getAccountBalance(
    publicKey: anchor.web3.PublicKey
  ): Promise<anchor.BN> {
    try {
      const accountInfo = await provider.connection.getAccountInfo(publicKey);
      if (!accountInfo) {
        throw new Error("Account does not exist or has no lamports");
      }
      if (typeof accountInfo.lamports !== "number") {
        throw new Error("Lamports value is not a number");
      }
      return new anchor.BN(accountInfo.lamports.toString());
    } catch (error) {
      console.error(
        `Failed to fetch balance for ${publicKey.toBase58()}:`,
        error
      );
      throw error;
    }
  }
});
