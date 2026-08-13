import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  makeStyles,
  tokens,
  Card,
  CardHeader,
  Text,
  Title3,
} from "@fluentui/react-components";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: "20px",
    padding: "20px",
  },
  cards: {
    display: "flex",
    gap: "20px",
  },
  card: {
    flex: 1,
  },
  chartContainer: {
    height: "300px",
    marginTop: "20px",
    backgroundColor: tokens.colorNeutralBackground1,
    padding: "20px",
    borderRadius: tokens.borderRadiusMedium,
  },
});

interface AnalyticsSummary {
  total_tasks_run: number;
  total_duration_ms: number;
}

export const AnalyticsDashboard: React.FC = () => {
  const styles = useStyles();
  const [summary, setSummary] = useState<AnalyticsSummary>({ total_tasks_run: 0, total_duration_ms: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchAnalytics = async () => {
      try {
        const result = await invoke<AnalyticsSummary>("get_analytics_summary");
        setSummary(result);
      } catch (error) {
        console.error("Failed to fetch analytics:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchAnalytics();
  }, []);

  const timeSavedSeconds = summary.total_tasks_run * 5;

  const data = [
    {
      name: 'Time Saved (s)',
      value: timeSavedSeconds,
    },
    {
      name: 'Tasks Run',
      value: summary.total_tasks_run,
    }
  ];

  if (loading) {
    return <div>Loading analytics...</div>;
  }

  return (
    <div className={styles.root}>
      <Title3>Performance Analytics</Title3>
      
      <div className={styles.cards}>
        <Card className={styles.card}>
          <CardHeader header={<Text weight="semibold">Total Scripts Run</Text>} />
          <div style={{ padding: "0 16px 16px" }}>
            <Text size={700}>{summary.total_tasks_run}</Text>
          </div>
        </Card>
        
        <Card className={styles.card}>
          <CardHeader header={<Text weight="semibold">Estimated Time Saved</Text>} />
          <div style={{ padding: "0 16px 16px" }}>
            <Text size={700}>{timeSavedSeconds}s</Text>
          </div>
        </Card>
      </div>

      <div className={styles.chartContainer}>
        <BarChart width={800} height={260} data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="name" />
          <YAxis />
          <Tooltip />
          <Bar dataKey="value" fill={tokens.colorBrandBackground} />
        </BarChart>
      </div>
    </div>
  );
};
