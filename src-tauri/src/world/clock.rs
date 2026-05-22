use chrono::NaiveDate;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct GameClock {
    pub current_date: NaiveDate,
    pub round: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TimeIncrement {
    OneWeek,
    OneMonth,
    ThreeMonths,
    SixMonths,
    OneYear,
}

impl TimeIncrement {
    pub fn days(self) -> i64 {
        match self {
            TimeIncrement::OneWeek => 7,
            TimeIncrement::OneMonth => 30,
            TimeIncrement::ThreeMonths => 91,
            TimeIncrement::SixMonths => 183,
            TimeIncrement::OneYear => 365,
        }
    }
}

impl GameClock {
    pub fn new(start: NaiveDate) -> Self {
        Self {
            current_date: start,
            round: 0,
        }
    }

    pub fn advance(&self, increment: TimeIncrement) -> GameClock {
        GameClock {
            current_date: self
                .current_date
                .checked_add_signed(chrono::Duration::days(increment.days()))
                .unwrap_or(self.current_date),
            round: self.round + 1,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Datelike;

    #[test]
    fn advance_increments_round_and_date() {
        let c = GameClock::new(NaiveDate::from_ymd_opt(1939, 9, 1).unwrap());
        let c2 = c.advance(TimeIncrement::OneMonth);
        assert_eq!(c2.round, 1);
        assert!(c2.current_date > c.current_date);
    }

    #[test]
    fn one_year_advances_about_365_days() {
        let c = GameClock::new(NaiveDate::from_ymd_opt(1939, 1, 1).unwrap());
        let c2 = c.advance(TimeIncrement::OneYear);
        assert_eq!(c2.current_date.year(), 1940);
    }
}
