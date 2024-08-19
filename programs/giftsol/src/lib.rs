use anchor_lang::prelude::*;
use anchor_lang::system_program::transfer;
use anchor_lang::system_program::Transfer;

declare_id!("95tdskrYsT3f2eCQAh9GUkrZWFo8rTM8aob1BhYcCFFS");


#[program]
pub mod giftsol {
    use super::*;
    pub fn create_giftcard(
        ctx: Context<CouponCreate>,
        seed: u64,
        coupon_code: String,
        amount: u64,
    ) -> Result<()> {
        let hashed_coupon_code = custom_hash(&coupon_code);
        ctx.accounts
            .create_giftcard(seed, hashed_coupon_code, amount, &ctx.bumps)?;
        Ok(())
    }

    pub fn avail(ctx: Context<CouponWithdraw>, coupon_code: String) -> Result<()> {
        let hashed_coupon_code = custom_hash(&coupon_code);
        ctx.accounts.withdraw(hashed_coupon_code)?;
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(seed: u64)]
pub struct CouponCreate<'info> {
    #[account(
        init, 
        payer = creator, 
        seeds = [b"giftcard", creator.key().as_ref(), seed.to_le_bytes().as_ref()],
        space = GiftCard::INIT_SPACE,
        bump,
    )]
    pub giftcard: Account<'info, GiftCard>,
    #[account(mut)]
    pub creator: Signer<'info>,
    pub system_program: Program<'info, System>,
}

impl<'info> CouponCreate<'info> {
    pub fn create_giftcard(
        &mut self,
        seed: u64,
        hashed_coupon_code: [u8; 32],
        amount: u64,
        bumps: &CouponCreateBumps,
    ) -> Result<()> {
        self.giftcard.set_inner(GiftCard {
            seed,
            creator: self.creator.key(),
            hashed_coupon_code, // TODO: add hashing
            amount,
            bump: bumps.giftcard,
        });

        let cpi_program = self.system_program.to_account_info();

        let cpi_accounts = Transfer {
            from: self.creator.to_account_info(),
            to: self.giftcard.to_account_info(),
        };

        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);

        transfer(cpi_ctx, amount)?;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct CouponWithdraw<'info> {
    #[account(
        mut,
        close = claimer, 
        seeds = [b"giftcard", giftcard.creator.key().as_ref(), giftcard.seed.to_le_bytes().as_ref()],
        bump = giftcard.bump,
    )]
    pub giftcard: Account<'info, GiftCard>,
    #[account(mut)]
    pub claimer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

impl<'info> CouponWithdraw<'info> {
    pub fn withdraw(&mut self, hashed_coupon_code: [u8; 32]) -> Result<()> {
        if self.giftcard.hashed_coupon_code != hashed_coupon_code {
            return Err(GiftError::InvalidCouponCode.into());
        }
        Ok(())
    }
}

#[account]
pub struct GiftCard {
    pub seed: u64,
    pub creator: Pubkey,
    pub hashed_coupon_code: [u8; 32],
    pub amount: u64,
    pub bump: u8,
}

impl Space for GiftCard {
    const INIT_SPACE: usize = 8 + 8 + 32 + 32 + 8 + 1;
}

#[error_code]
pub enum GiftError {
    #[msg("Invalid Coupon Code")]
    InvalidCouponCode,
    #[msg{"Insufficient Amount"}]
    InsufficientAmmount,
}

fn custom_hash(input: &str) -> [u8; 32] {
    let mut output = [0u8; 32];
    let input_bytes = input.as_bytes();

    for (i, byte) in input_bytes.iter().enumerate() {
        output[i % 32] ^= byte;
    }

    output
}
